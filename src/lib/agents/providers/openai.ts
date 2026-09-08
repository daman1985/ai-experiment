import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  turnOutputSchema,
  type ProviderAdapter,
  type RunTurnInput,
  type RunTurnResult,
  type ToolCallLogEntry,
} from "../schema";
import { buildResearchPrompt, buildTurnPrompt } from "../prompt";
import { withTimeout } from "../withTimeout";
import { logDiagnostic } from "@/lib/diagnostics";

const RESEARCH_MAX_TOKENS = 2000;
const TURN_MAX_TOKENS = 2000;

// Diagnosed directly from a production cron tick: this SDK defaults to a
// 10-MINUTE request timeout with automatic retries on timeout, so a slow
// web-search call just sits there far past the cron route's maxDuration
// -- the function gets hard-killed before this call's own try/catch ever
// gets a chance to fall back gracefully. The SDK-level `timeout` option
// below is kept, but withTimeout() (a plain Promise.race) is the actual
// guarantee. These were originally 15s/20s on the theory that a hung call
// needed cutting short quickly; confirmed directly against production
// (via the Anthropic adapter, which sends the same underlying real
// prompts) that a real web-search research call can legitimately take
// ~35s and genuinely original turn reasoning ~24s -- not hangs, just cut
// off too early. Raised with margin to match; kept in sync with
// anthropic.ts's timeouts and engine.ts's MIN_TURN_BUDGET_MS.
//
// TURN_TIMEOUT_MS raised a second time to 60s in lockstep with
// anthropic.ts -- see that file's comment: real Watch Live turns kept
// hitting the 35s ceiling once TURN_MAX_TOKENS there doubled, since
// generation time tracks output length, not input size.
const RESEARCH_TIMEOUT_MS = 40_000;
const TURN_TIMEOUT_MS = 60_000;

// Uses the current `web_search` tool (not the legacy `web_search_preview`
// this adapter originally shipped with) -- confirmed against OpenAI's own
// live pricing page during the September 2026 model-selection research
// pass: the current tool is unified across reasoning/non-reasoning models
// at $10/1k calls + search-content tokens at the model's normal rate,
// where the legacy preview name had a split, more expensive pricing
// table. The shape of `response.output` tool-call items below
// (`web_search_call` / `.action.query`) was confirmed directly against
// this project's installed `openai` SDK types (v7.10.0), not recalled
// from training -- still worth a smoke test against a real key before a
// full autonomous run, since hosted-tool response shapes do shift
// between SDK versions.
export const openaiAdapter: ProviderAdapter = {
  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const client = new OpenAI({ apiKey: input.apiKey, maxRetries: 1 });

    let inputTokens = 0;
    let outputTokens = 0;
    let researchNote: string | null = null;
    const toolCalls: ToolCallLogEntry[] = [];

    if (input.enableResearch) {
      const researchStart = Date.now();
      try {
        const researchResponse = await withTimeout(
          (signal) =>
            client.responses.create(
              {
                model: input.modelId,
                instructions: input.systemPrompt,
                // No max-calls-per-turn equivalent to Anthropic's max_uses is
                // exposed on this tool type -- search_context_size: "low"
                // trims how much each individual search processes, but the
                // request timeout below is the real backstop against an
                // open-ended multi-search loop.
                tools: [{ type: "web_search", search_context_size: "low" }],
                input: buildResearchPrompt(input.transcript, input.selfRoomLabel),
              },
              { timeout: RESEARCH_TIMEOUT_MS, signal },
            ),
          RESEARCH_TIMEOUT_MS,
          "OpenAI research call",
        );

        inputTokens += researchResponse.usage?.input_tokens ?? 0;
        outputTokens += researchResponse.usage?.output_tokens ?? 0;
        researchNote = researchResponse.output_text?.trim() || null;

        // Search results themselves aren't attached to the web_search_call
        // item -- they surface as url_citation annotations on the message
        // text that follows it. Collected separately and applied to every
        // search logged this call, since there's no clean call-to-citation
        // mapping exposed.
        const citationTitles: string[] = [];
        for (const item of researchResponse.output ?? []) {
          if (item.type === "web_search_call") {
            const action = (item as { action?: { query?: string } }).action;
            toolCalls.push({ query: action?.query ?? "(unknown query)", resultSummary: "" });
          } else if (item.type === "message") {
            for (const part of (item as { content?: unknown[] }).content ?? []) {
              const annotations = (part as { annotations?: unknown[] }).annotations ?? [];
              for (const ann of annotations) {
                const a = ann as { type?: string; title?: string; url?: string };
                if (a.type === "url_citation" && (a.title || a.url)) {
                  citationTitles.push(a.title || a.url || "");
                }
              }
            }
          }
        }
        const citationSummary = citationTitles.slice(0, 3).join("; ") || "(no source details available)";
        for (const tc of toolCalls) tc.resultSummary = citationSummary;
        await logDiagnostic({
          source: "openai:research",
          level: "info",
          runId: input.runId,
          message: `succeeded in ${Date.now() - researchStart}ms`,
        });
      } catch (err) {
        // Research is a best-effort enhancement, not required for the turn
        // to proceed -- don't let a tool/API surface change block the run.
        researchNote = null;
        toolCalls.push({
          query: "(research step failed)",
          resultSummary: err instanceof Error ? err.message : String(err),
        });
        await logDiagnostic({
          source: "openai:research",
          level: "error",
          runId: input.runId,
          message: `failed after ${Date.now() - researchStart}ms: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const turnText = buildTurnPrompt({
      transcript: input.transcript,
      selfRoomLabel: input.selfRoomLabel,
      researchNote,
      documents: input.documents,
    });
    const imageDocs = input.documents.filter((d) => d.kind === "IMAGE");

    const turnStart = Date.now();
    let turnResponse;
    try {
      turnResponse = await withTimeout(
        (signal) =>
          client.responses.parse(
            {
              model: input.modelId,
              instructions: input.systemPrompt,
              text: { format: zodTextFormat(turnOutputSchema, "turn_output") },
              input:
                imageDocs.length === 0
                  ? turnText
                  : [
                      {
                        role: "user" as const,
                        content: [
                          { type: "input_text" as const, text: turnText },
                          ...imageDocs.map((d) => ({
                            type: "input_image" as const,
                            image_url: `data:${d.mimeType};base64,${d.content}`,
                            detail: "auto" as const,
                          })),
                        ],
                      },
                    ],
            },
            { timeout: TURN_TIMEOUT_MS, signal },
          ),
        TURN_TIMEOUT_MS,
        "OpenAI turn call",
      );
    } catch (err) {
      await logDiagnostic({
        source: "openai:turn",
        level: "error",
        runId: input.runId,
        message: `failed after ${Date.now() - turnStart}ms: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
    await logDiagnostic({
      source: "openai:turn",
      level: "info",
      runId: input.runId,
      message: `succeeded in ${Date.now() - turnStart}ms`,
    });

    inputTokens += turnResponse.usage?.input_tokens ?? 0;
    outputTokens += turnResponse.usage?.output_tokens ?? 0;

    if (!turnResponse.output_parsed) {
      throw new Error("OpenAI response failed to parse into the required turn schema.");
    }

    return {
      output: turnResponse.output_parsed,
      inputTokens,
      outputTokens,
      toolCalls,
    };
  },
};

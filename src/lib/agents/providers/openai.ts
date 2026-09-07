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

const RESEARCH_MAX_TOKENS = 2000;
const TURN_MAX_TOKENS = 2000;

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
    const client = new OpenAI({ apiKey: input.apiKey });

    let inputTokens = 0;
    let outputTokens = 0;
    let researchNote: string | null = null;
    const toolCalls: ToolCallLogEntry[] = [];

    if (input.enableResearch) {
      try {
        const researchResponse = await client.responses.create({
          model: input.modelId,
          instructions: input.systemPrompt,
          tools: [{ type: "web_search" }],
          input: buildResearchPrompt(input.transcript, input.selfRoomLabel),
        });

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
      } catch (err) {
        // Research is a best-effort enhancement, not required for the turn
        // to proceed -- don't let a tool/API surface change block the run.
        researchNote = null;
        toolCalls.push({
          query: "(research step failed)",
          resultSummary: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const turnResponse = await client.responses.parse({
      model: input.modelId,
      instructions: input.systemPrompt,
      text: { format: zodTextFormat(turnOutputSchema, "turn_output") },
      input: buildTurnPrompt({
        transcript: input.transcript,
        selfRoomLabel: input.selfRoomLabel,
        researchNote,
      }),
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

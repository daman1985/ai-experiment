import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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

// The SDK's own `timeout` request option is passed below too; withTimeout()
// is the actual guarantee -- a plain Promise.race the calling code can't
// get stuck behind regardless of what the SDK does internally.
//
// These were originally 15s/20s on the theory that a hung call needed to
// be cut short quickly since up to two active runs could share one 60s
// tick. That theory was wrong: confirmed directly against production via
// a battery of real calls with the app's actual prompts (not placeholder
// content) that a real web-search research call can legitimately take
// ~35s, and genuinely original reasoning for a turn (inventing and
// critiquing a real proposal, not restating trivially-prescribed content)
// can legitimately take ~24s -- every prior "hang" was these calls being
// cut off mid-flight, not stuck. Raised with real margin above both
// observed times; the cron route's own maxDuration and the shared-
// deadline math in engine.ts are raised to match (see MIN_TURN_BUDGET_MS).
const RESEARCH_TIMEOUT_MS = 40_000;
const TURN_TIMEOUT_MS = 35_000;

export const anthropicAdapter: ProviderAdapter = {
  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const client = new Anthropic({ apiKey: input.apiKey, maxRetries: 1 });

    let inputTokens = 0;
    let outputTokens = 0;
    let researchNote: string | null = null;
    const toolCalls: ToolCallLogEntry[] = [];

    if (input.enableResearch) {
      const researchStart = Date.now();
      try {
        const researchResponse = await withTimeout(
          (signal) =>
            client.messages.create(
              {
                model: input.modelId,
                max_tokens: RESEARCH_MAX_TOKENS,
                system: input.systemPrompt,
                // Capped to one direct search per research turn -- per the
                // September 2026 model-selection research, every extra internal
                // search/code-execution iteration is tail latency this app can't
                // afford under RESEARCH_TIMEOUT_MS. `allowed_callers:
                // ["direct"]` opts out of the newer dynamic-filtering-via-code-
                // execution default for the same reason.
                tools: [
                  {
                    type: "web_search_20260318",
                    name: "web_search",
                    max_uses: 1,
                    allowed_callers: ["direct"],
                  },
                ],
                messages: [
                  {
                    role: "user",
                    content: buildResearchPrompt(input.transcript, input.selfRoomLabel),
                  },
                ],
              },
              { timeout: RESEARCH_TIMEOUT_MS, signal },
            ),
          RESEARCH_TIMEOUT_MS,
          "Anthropic research call",
        );

        inputTokens += researchResponse.usage.input_tokens;
        outputTokens += researchResponse.usage.output_tokens;

        const textParts: string[] = [];
        for (const block of researchResponse.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "server_tool_use" && block.name === "web_search") {
            const queryInput = block.input as { query?: string };
            toolCalls.push({ query: queryInput.query ?? "(unknown query)", resultSummary: "" });
          } else if (block.type === "web_search_tool_result") {
            const last = toolCalls[toolCalls.length - 1];
            if (last) {
              const content = block.content;
              if (Array.isArray(content)) {
                last.resultSummary =
                  content
                    .slice(0, 3)
                    .map((r) => ("title" in r ? r.title : ""))
                    .filter(Boolean)
                    .join("; ") || "(no source details available)";
              } else {
                // A real typed error from Anthropic's search tool (rate
                // limited, query too long, service unavailable, etc.) --
                // surface the actual code instead of a blanket "search
                // error" that hides whether this is a fluke or chronic.
                const errorCode = (content as { error_code?: string })?.error_code;
                last.resultSummary = errorCode ? `search failed: ${errorCode}` : "(search failed)";
              }
            }
          }
        }
        researchNote = textParts.join("\n").trim() || null;
        await logDiagnostic({
          source: "anthropic:research",
          level: "info",
          runId: input.runId,
          message: `succeeded in ${Date.now() - researchStart}ms`,
        });
      } catch (err) {
        // Research is a best-effort enhancement, not required for the turn
        // to proceed -- a timeout or transient API error here shouldn't
        // block the turn, same reasoning as the OpenAI/Gemini adapters.
        researchNote = null;
        toolCalls.push({
          query: "(research step failed)",
          resultSummary: err instanceof Error ? err.message : String(err),
        });
        await logDiagnostic({
          source: "anthropic:research",
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
          client.messages.parse(
            {
              model: input.modelId,
              max_tokens: TURN_MAX_TOKENS,
              system: input.systemPrompt,
              output_config: { format: zodOutputFormat(turnOutputSchema) },
              messages: [
                {
                  role: "user",
                  content:
                    imageDocs.length === 0
                      ? turnText
                      : [
                          { type: "text", text: turnText },
                          ...imageDocs.map((d) => ({
                            type: "image" as const,
                            source: {
                              type: "base64" as const,
                              media_type: d.mimeType as
                                | "image/jpeg"
                                | "image/png"
                                | "image/gif"
                                | "image/webp",
                              data: d.content,
                            },
                          })),
                        ],
                },
              ],
            },
            { timeout: TURN_TIMEOUT_MS, signal },
          ),
        TURN_TIMEOUT_MS,
        "Anthropic turn call",
      );
    } catch (err) {
      await logDiagnostic({
        source: "anthropic:turn",
        level: "error",
        runId: input.runId,
        message: `failed after ${Date.now() - turnStart}ms: ${err instanceof Error ? err.message : String(err)}`,
        detail: { systemPromptLength: input.systemPrompt.length, turnTextLength: turnText.length },
      });
      throw err;
    }
    await logDiagnostic({
      source: "anthropic:turn",
      level: "info",
      runId: input.runId,
      message: `succeeded in ${Date.now() - turnStart}ms`,
    });

    inputTokens += turnResponse.usage.input_tokens;
    outputTokens += turnResponse.usage.output_tokens;

    if (!turnResponse.parsed_output) {
      throw new Error("Anthropic response failed to parse into the required turn schema.");
    }

    return {
      output: turnResponse.parsed_output,
      inputTokens,
      outputTokens,
      toolCalls,
    };
  },
};

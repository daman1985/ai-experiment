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

const RESEARCH_MAX_TOKENS = 2000;
const TURN_MAX_TOKENS = 2000;

// The SDK's own `timeout` request option is passed below too, but a real
// production hang proved it isn't reliably enforced in this environment
// -- the call ran the cron route's full 60s to a hard kill despite a
// 20s timeout being set. withTimeout() is the actual guarantee: a plain
// Promise.race the calling code can't get stuck behind regardless of
// what the SDK does internally. Kept tight since up to two active runs
// can share one 60s invocation (see cron/tick/route.ts).
const RESEARCH_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_MS = 20_000;

export const anthropicAdapter: ProviderAdapter = {
  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const client = new Anthropic({ apiKey: input.apiKey, maxRetries: 1 });

    let inputTokens = 0;
    let outputTokens = 0;
    let researchNote: string | null = null;
    const toolCalls: ToolCallLogEntry[] = [];

    if (input.enableResearch) {
      try {
        const researchResponse = await withTimeout(
          client.messages.create(
            {
              model: input.modelId,
              max_tokens: RESEARCH_MAX_TOKENS,
              system: input.systemPrompt,
              // Capped to one direct search per research turn -- per the
              // September 2026 model-selection research, every extra internal
              // search/code-execution iteration is tail latency this app can't
              // afford under the 60s serverless timeout. `allowed_callers:
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
            { timeout: RESEARCH_TIMEOUT_MS },
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
      } catch (err) {
        // Research is a best-effort enhancement, not required for the turn
        // to proceed -- a timeout or transient API error here shouldn't
        // block the turn, same reasoning as the OpenAI/Gemini adapters.
        researchNote = null;
        toolCalls.push({
          query: "(research step failed)",
          resultSummary: err instanceof Error ? err.message : String(err),
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

    const turnResponse = await withTimeout(
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
        { timeout: TURN_TIMEOUT_MS },
      ),
      TURN_TIMEOUT_MS,
      "Anthropic turn call",
    );

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

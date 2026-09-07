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

const RESEARCH_MAX_TOKENS = 2000;
const TURN_MAX_TOKENS = 2000;

export const anthropicAdapter: ProviderAdapter = {
  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const client = new Anthropic({ apiKey: input.apiKey });

    let inputTokens = 0;
    let outputTokens = 0;
    let researchNote: string | null = null;
    const toolCalls: ToolCallLogEntry[] = [];

    if (input.enableResearch) {
      const researchResponse = await client.messages.create({
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
      });

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
    }

    const turnText = buildTurnPrompt({
      transcript: input.transcript,
      selfRoomLabel: input.selfRoomLabel,
      researchNote,
      documents: input.documents,
    });
    const imageDocs = input.documents.filter((d) => d.kind === "IMAGE");

    const turnResponse = await client.messages.parse({
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
                      media_type: d.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                      data: d.content,
                    },
                  })),
                ],
        },
      ],
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

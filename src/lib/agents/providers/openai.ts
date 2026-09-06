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

// NOTE: OpenAI's Responses API and its hosted web-search tool move fast and
// this environment's network egress blocked live docs while building this
// adapter (platform.openai.com, openrouter.ai were both unreachable) --
// verify the `web_search_preview` tool type and the exact shape of
// `response.output` tool-call items against a real key before a full
// autonomous run. Token usage extraction and structured-output parsing
// follow OpenAI's documented Responses API conventions and are lower-risk.
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
          tools: [{ type: "web_search_preview" }],
          input: buildResearchPrompt(input.transcript, input.selfDisplayName),
        });

        inputTokens += researchResponse.usage?.input_tokens ?? 0;
        outputTokens += researchResponse.usage?.output_tokens ?? 0;
        researchNote = researchResponse.output_text?.trim() || null;

        for (const item of researchResponse.output ?? []) {
          if (item.type === "web_search_call") {
            const action = (item as { action?: { query?: string } }).action;
            toolCalls.push({ query: action?.query ?? "(unknown query)", resultSummary: "" });
          }
        }
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
        selfDisplayName: input.selfDisplayName,
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

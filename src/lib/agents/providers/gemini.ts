import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type {
  ProviderAdapter,
  RunTurnInput,
  RunTurnResult,
  ToolCallLogEntry,
  TurnOutput,
} from "../schema";
import { buildResearchPrompt, buildTurnPrompt } from "../prompt";

// Hand-written to match turnOutputSchema in ../schema.ts (kept in sync
// manually -- Gemini's structured-output schema is the OpenAPI-subset
// `Schema` type from @google/genai, not standard JSON Schema, so it can't
// be derived from the shared zod schema the way the Anthropic/OpenAI
// adapters do).
const TURN_OUTPUT_GEMINI_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    message: { type: Type.STRING },
    weaknessCritique: { type: Type.STRING },
    readyToDecide: { type: Type.BOOLEAN },
    yieldToDisplayName: { type: Type.STRING, nullable: true },
    voteChoice: { type: Type.STRING, nullable: true },
    artifact: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        type: { type: Type.STRING },
        title: { type: Type.STRING },
        content: { type: Type.STRING },
      },
      required: ["type", "title", "content"],
    },
  },
  required: [
    "message",
    "weaknessCritique",
    "readyToDecide",
    "yieldToDisplayName",
    "voteChoice",
    "artifact",
  ],
};

// NOTE: as with the OpenAI adapter, live docs (ai.google.dev) were
// unreachable from this environment while building this file. The shapes
// below (systemInstruction/responseSchema/googleSearch under `config`,
// response.text, response.usageMetadata.*TokenCount) were confirmed
// directly against this project's installed @google/genai type
// definitions, not recalled from training -- but Gemini's documented
// behavior of not combining `tools` with `responseSchema` in one call is
// from training and should be smoke-tested with a real key.
export const geminiAdapter: ProviderAdapter = {
  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const ai = new GoogleGenAI({ apiKey: input.apiKey });

    let inputTokens = 0;
    let outputTokens = 0;
    let researchNote: string | null = null;
    const toolCalls: ToolCallLogEntry[] = [];

    if (input.enableResearch) {
      try {
        const researchResponse = await ai.models.generateContent({
          model: input.modelId,
          contents: buildResearchPrompt(input.transcript, input.selfDisplayName),
          config: {
            systemInstruction: input.systemPrompt,
            tools: [{ googleSearch: {} }],
          },
        });

        inputTokens += researchResponse.usageMetadata?.promptTokenCount ?? 0;
        outputTokens += researchResponse.usageMetadata?.candidatesTokenCount ?? 0;
        researchNote = researchResponse.text?.trim() || null;

        const queries = researchResponse.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
        for (const query of queries) {
          toolCalls.push({ query, resultSummary: "" });
        }
      } catch (err) {
        researchNote = null;
        toolCalls.push({
          query: "(research step failed)",
          resultSummary: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const turnResponse = await ai.models.generateContent({
      model: input.modelId,
      contents: buildTurnPrompt({
        transcript: input.transcript,
        selfDisplayName: input.selfDisplayName,
        researchNote,
      }),
      config: {
        systemInstruction: input.systemPrompt,
        responseMimeType: "application/json",
        responseSchema: TURN_OUTPUT_GEMINI_SCHEMA,
      },
    });

    inputTokens += turnResponse.usageMetadata?.promptTokenCount ?? 0;
    outputTokens += turnResponse.usageMetadata?.candidatesTokenCount ?? 0;

    const rawText = turnResponse.text;
    if (!rawText) {
      throw new Error("Gemini returned no text content for the structured turn response.");
    }

    let output: TurnOutput;
    try {
      output = JSON.parse(rawText) as TurnOutput;
    } catch {
      throw new Error(`Gemini response failed to parse as JSON: ${rawText.slice(0, 200)}`);
    }

    return { output, inputTokens, outputTokens, toolCalls };
  },
};

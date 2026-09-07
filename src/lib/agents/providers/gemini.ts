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
    confidenceBeforePeerUpdate: { type: Type.NUMBER },
    confidenceAfterPeerUpdate: { type: Type.NUMBER },
    readyToDecide: { type: Type.BOOLEAN },
    yieldToRoomLabel: { type: Type.STRING, nullable: true },
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
    "confidenceBeforePeerUpdate",
    "confidenceAfterPeerUpdate",
    "readyToDecide",
    "yieldToRoomLabel",
    "voteChoice",
    "artifact",
  ],
};

// NOTE: as with the OpenAI adapter, live docs (ai.google.dev) were
// unreachable from this environment while building this file. The shapes
// below (systemInstruction/responseSchema/googleSearch under `config`,
// response.text, response.usageMetadata.*TokenCount) were confirmed
// directly against this project's installed @google/genai type
// definitions, not recalled from training.
//
// This still runs research and structured output as two separate calls.
// One of the two September 2026 model-selection research reports claims
// Google's current Gemini 3-series structured-output docs show
// `googleSearch` and `responseSchema` combinable in a single request
// (Preview); the other claims the opposite, citing an older/third-party
// source. The two reports disagree and this environment can't reach
// ai.google.dev to settle it -- so this keeps the conservative two-call
// path rather than gambling the turn on an unverified capability. Worth
// smoke-testing the single-call path directly against a real key before
// optimizing this away.
// Diagnosed directly from a production cron tick: the Anthropic and
// OpenAI SDKs both default to a 10-MINUTE request timeout with automatic
// retries, and a hung provider call was observed blowing straight through
// the cron route's 60s maxDuration -- the function gets hard-killed
// before the call's own try/catch ever runs. This SDK's default is
// unconfirmed but the same risk applies, so it gets the same explicit
// bound rather than trusting whatever the default turns out to be.
const RESEARCH_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 25_000;

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
          contents: buildResearchPrompt(input.transcript, input.selfRoomLabel),
          config: {
            systemInstruction: input.systemPrompt,
            tools: [{ googleSearch: {} }],
            httpOptions: { timeout: RESEARCH_TIMEOUT_MS },
          },
        });

        inputTokens += researchResponse.usageMetadata?.promptTokenCount ?? 0;
        outputTokens += researchResponse.usageMetadata?.candidatesTokenCount ?? 0;
        researchNote = researchResponse.text?.trim() || null;

        const grounding = researchResponse.candidates?.[0]?.groundingMetadata;
        const queries = grounding?.webSearchQueries ?? [];
        const chunkSummary =
          (grounding?.groundingChunks ?? [])
            .slice(0, 3)
            .map((c) => c.web?.title || c.web?.uri || "")
            .filter(Boolean)
            .join("; ") || "(no source details available)";
        for (const query of queries) {
          toolCalls.push({ query, resultSummary: chunkSummary });
        }
      } catch (err) {
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

    const turnResponse = await ai.models.generateContent({
      model: input.modelId,
      contents:
        imageDocs.length === 0
          ? turnText
          : [
              {
                role: "user",
                parts: [
                  { text: turnText },
                  ...imageDocs.map((d) => ({
                    inlineData: { mimeType: d.mimeType, data: d.content },
                  })),
                ],
              },
            ],
      config: {
        systemInstruction: input.systemPrompt,
        responseMimeType: "application/json",
        responseSchema: TURN_OUTPUT_GEMINI_SCHEMA,
        httpOptions: { timeout: TURN_TIMEOUT_MS },
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

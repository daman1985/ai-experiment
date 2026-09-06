import type { Provider } from "@prisma/client";
import type { ProviderAdapter } from "./schema";
import { anthropicAdapter } from "./providers/anthropic";
import { openaiAdapter } from "./providers/openai";
import { geminiAdapter } from "./providers/gemini";

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  ANTHROPIC: anthropicAdapter,
  OPENAI: openaiAdapter,
  GOOGLE: geminiAdapter,
};

export function getProviderAdapter(provider: Provider): ProviderAdapter {
  return ADAPTERS[provider];
}

// Pricing is admin-entered (see ProviderConfig in schema.prisma) since we
// have no reliable way to fetch current rate cards live -- this just
// applies whatever rate the admin configured, per million tokens.
export function computeCostUsd(params: {
  inputTokens: number;
  outputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}): number {
  const { inputTokens, outputTokens, inputPricePerMillion, outputPricePerMillion } = params;
  return (
    (inputTokens / 1_000_000) * inputPricePerMillion +
    (outputTokens / 1_000_000) * outputPricePerMillion
  );
}

export * from "./schema";
export { buildSystemPrompt } from "./prompt";

import type { Provider } from "@prisma/client";

// Single source of truth for "which providers does this app know how to
// run" -- used by both the settings page and run creation. Adding a new
// lab later means: (1) write its ProviderAdapter, (2) add the enum value
// via a migration, (3) add one entry here. Everything else (settings
// form, run roster picker) picks it up automatically.
export interface ProviderRegistryEntry {
  id: Provider;
  displayName: string; // real identity used as the agent's name in the room -- never a persona
  pricingUrl: string;
  modelHint: string;
}

export const PROVIDER_REGISTRY: ProviderRegistryEntry[] = [
  {
    id: "ANTHROPIC",
    displayName: "Claude",
    pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    modelHint: "e.g. claude-haiku-4-5",
  },
  {
    id: "OPENAI",
    displayName: "GPT",
    pricingUrl: "https://platform.openai.com/docs/pricing",
    modelHint: "e.g. gpt-4o-mini -- confirm the current cheapest model in the OpenAI console",
  },
  {
    id: "GOOGLE",
    displayName: "Gemini",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    modelHint: "e.g. gemini-2.5-flash -- confirm the current cheapest model in AI Studio",
  },
];

export function registryEntry(id: Provider): ProviderRegistryEntry {
  const entry = PROVIDER_REGISTRY.find((p) => p.id === id);
  if (!entry) throw new Error(`No registry entry for provider ${id}`);
  return entry;
}

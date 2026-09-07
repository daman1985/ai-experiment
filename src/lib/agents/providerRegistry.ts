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

// Model hints reflect the roster from the September 2026 model-selection
// research pass (two independent deep-research reports plus the admin's
// own manually-fetched pricing pages, cross-checked against each other --
// see conversation history / docs/design-system.md): claude-sonnet-5 /
// gpt-5.6-terra / gemini-3.8-flash, chosen for being roughly
// capability-matched across providers (not just price-matched) while
// staying safely inside the 60s serverless timeout. Still just a
// starting hint, not enforced -- confirm current pricing at the URL
// below before saving, since rate cards change often.
export const PROVIDER_REGISTRY: ProviderRegistryEntry[] = [
  {
    id: "ANTHROPIC",
    displayName: "Claude",
    pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    modelHint: "e.g. claude-sonnet-5 ($2/$10 per MTok, confirmed live Sept 2026)",
  },
  {
    id: "OPENAI",
    displayName: "GPT",
    pricingUrl: "https://developers.openai.com/api/docs/pricing",
    modelHint: "e.g. gpt-5.6-terra ($2/$12 per MTok, confirmed live Sept 2026)",
  },
  {
    id: "GOOGLE",
    displayName: "Gemini",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    modelHint:
      "e.g. gemini-3.8-flash ($0.75/$3.75 per MTok through Dec 31 2026, then $1.50/$7.50 -- confirmed live Sept 2026)",
  },
];

export function registryEntry(id: Provider): ProviderRegistryEntry {
  const entry = PROVIDER_REGISTRY.find((p) => p.id === id);
  if (!entry) throw new Error(`No registry entry for provider ${id}`);
  return entry;
}

import { prisma } from "@/lib/db";
import type { Provider } from "@prisma/client";
import { saveProviderConfigAction } from "../../actions";

export const dynamic = "force-dynamic";

const PROVIDERS: { id: Provider; label: string; pricingUrl: string; modelHint: string }[] = [
  {
    id: "ANTHROPIC",
    label: "Claude (Anthropic)",
    pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    modelHint: "e.g. claude-haiku-4-5",
  },
  {
    id: "OPENAI",
    label: "GPT (OpenAI)",
    pricingUrl: "https://platform.openai.com/docs/pricing",
    modelHint: "e.g. gpt-4o-mini -- confirm the current cheapest model in the OpenAI console",
  },
  {
    id: "GOOGLE",
    label: "Gemini (Google)",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    modelHint: "e.g. gemini-2.5-flash -- confirm the current cheapest model in AI Studio",
  },
];

export default async function SettingsPage() {
  const configs = await prisma.providerConfig.findMany();
  const byProvider = new Map(configs.map((c) => [c.provider, c]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Provider settings</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Pricing is entered here rather than assumed by the app -- rate cards change often, so
          check each provider&apos;s current pricing page (linked below) before saving.
        </p>
      </div>

      {PROVIDERS.map(({ id, label, pricingUrl, modelHint }) => {
        const config = byProvider.get(id);
        return (
          <form
            key={id}
            action={saveProviderConfigAction}
            className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-5"
          >
            <input type="hidden" name="provider" value={id} />
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{label}</h2>
              <span className="text-xs text-neutral-500">
                {config ? "Key configured" : "Not configured"}
              </span>
            </div>

            <div>
              <label className="mb-1 block text-sm text-neutral-400">
                API key {config && "(leave blank to keep the existing key)"}
              </label>
              <input
                type="password"
                name="apiKey"
                placeholder={config ? "••••••••••••" : "sk-..."}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-neutral-400">Model ID</label>
              <input
                type="text"
                name="defaultModelId"
                defaultValue={config?.defaultModelId ?? ""}
                placeholder={modelHint}
                required
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-neutral-400">
                  Input $ / 1M tokens
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="inputPricePerMillion"
                  defaultValue={config ? Number(config.inputPricePerMillion) : ""}
                  required
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-neutral-400">
                  Output $ / 1M tokens
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="outputPricePerMillion"
                  defaultValue={config ? Number(config.outputPricePerMillion) : ""}
                  required
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                />
              </div>
            </div>

            <a
              href={pricingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-neutral-500 hover:underline"
            >
              Check current pricing →
            </a>

            <button
              type="submit"
              className="w-full rounded bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
            >
              Save {label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

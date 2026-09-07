import { prisma } from "@/lib/db";
import { PROVIDER_REGISTRY } from "@/lib/agents/providerRegistry";
import { saveProviderConfigAction } from "../../actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const configs = await prisma.providerConfig.findMany();
  const byProvider = new Map(configs.map((c) => [c.provider, c]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-text-primary">Provider settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Pricing is entered here rather than assumed by the app -- rate cards change often, so
          check each provider&apos;s current pricing page (linked below) before saving. Configure
          any subset here -- which ones actually join a run is chosen when you create it.
        </p>
      </div>

      {PROVIDER_REGISTRY.map(({ id, displayName, pricingUrl, modelHint }) => {
        const label = displayName;
        const config = byProvider.get(id);
        return (
          <form key={id} action={saveProviderConfigAction}>
            <Card className="space-y-4">
              <input type="hidden" name="provider" value={id} />
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg text-text-primary">{label}</h2>
                <Badge variant={config ? "success" : "neutral"}>
                  {config ? "Key configured" : "Not configured"}
                </Badge>
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-secondary">
                  API key {config && "(leave blank to keep the existing key)"}
                </label>
                <Input
                  type="password"
                  name="apiKey"
                  placeholder={config ? "••••••••••••" : "sk-..."}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-secondary">Model ID</label>
                <Input
                  type="text"
                  name="defaultModelId"
                  defaultValue={config?.defaultModelId ?? ""}
                  placeholder={modelHint}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-text-secondary">
                    Input $ / 1M tokens
                  </label>
                  <Input
                    type="number"
                    step="0.0001"
                    name="inputPricePerMillion"
                    defaultValue={config ? Number(config.inputPricePerMillion) : ""}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-text-secondary">
                    Output $ / 1M tokens
                  </label>
                  <Input
                    type="number"
                    step="0.0001"
                    name="outputPricePerMillion"
                    defaultValue={config ? Number(config.outputPricePerMillion) : ""}
                    required
                  />
                </div>
              </div>

              <a
                href={pricingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs text-text-tertiary transition-colors hover:text-text-primary"
              >
                Check current pricing &rarr;
              </a>

              <Button type="submit" variant="primary" className="w-full">
                Save {label}
              </Button>
            </Card>
          </form>
        );
      })}
    </div>
  );
}

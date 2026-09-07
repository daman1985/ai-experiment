import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROVIDER_REGISTRY } from "@/lib/agents/providerRegistry";
import { createRunAction, startRunAction, pauseRunAction, stopRunAction } from "../actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fmtUsd, formatPhase, runStatusVariant } from "@/lib/format";

// This reads live run/agent state and requires an authenticated session --
// never prerender it at build time.
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const runs = await prisma.run.findMany({
    orderBy: { createdAt: "desc" },
    include: { agents: true },
  });
  const configuredProviders = await prisma.providerConfig.findMany();
  const configuredIds = new Set(configuredProviders.map((c) => c.provider));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-text-primary">Runs</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Each run creates one agent per provider you select below, using the model and pricing
          configured in Settings. Starting a run makes it eligible for the cron job to advance --
          nothing happens until the cron tick fires.
        </p>
      </div>

      <div className="space-y-3">
        {runs.length === 0 && <p className="text-sm text-text-tertiary">No runs yet.</p>}
        {runs.map((run) => {
          const totalSpend =
            run.agents.reduce((sum, a) => sum + Number(a.spendUsd), 0) + Number(run.systemSpendUsd);
          return (
            <Card key={run.id} className="text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{run.name ?? run.id}</span>
                  <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
                </div>
                <Link
                  href={`/runs/${run.id}`}
                  className="text-text-secondary transition-colors hover:text-text-primary"
                >
                  View log &rarr;
                </Link>
              </div>
              <div className="mt-2 tabular-nums text-text-secondary">
                Phase: {formatPhase(run.currentPhase)} &middot; Spend:{" "}
                {fmtUsd(totalSpend)} / {fmtUsd(Number(run.totalBudgetCapUsd))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 tabular-nums text-text-tertiary">
                {run.agents.map((a) => (
                  <span key={a.id}>
                    {a.displayName}: {fmtUsd(Number(a.spendUsd))} /{" "}
                    {fmtUsd(Number(a.budgetCapUsd))} {a.isActive ? "" : "(inactive)"}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                {run.status !== "ACTIVE" && !run.status.startsWith("STOPPED") && run.status !== "COMPLETED" && (
                  <form action={startRunAction}>
                    <input type="hidden" name="runId" value={run.id} />
                    <Button type="submit" variant="primary" className="px-2 py-1 text-xs">
                      Start
                    </Button>
                  </form>
                )}
                {run.status === "ACTIVE" && (
                  <form action={pauseRunAction}>
                    <input type="hidden" name="runId" value={run.id} />
                    <Button type="submit" variant="secondary" className="px-2 py-1 text-xs">
                      Pause
                    </Button>
                  </form>
                )}
                {(run.status === "ACTIVE" || run.status === "PAUSED") && (
                  <form action={stopRunAction}>
                    <input type="hidden" name="runId" value={run.id} />
                    <Button type="submit" variant="danger" className="px-2 py-1 text-xs">
                      Stop
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <form action={createRunAction} className="space-y-4">
        <Card className="space-y-4">
          <h2 className="font-serif text-lg text-text-primary">New run</h2>
          <div>
            <label className="mb-1 block text-sm text-text-secondary">Name (optional)</label>
            <Input type="text" name="name" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-text-secondary">
              Participants (pick at least 2)
            </label>
            <div className="flex flex-wrap gap-4">
              {PROVIDER_REGISTRY.map((p) => {
                const configured = configuredIds.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 text-sm ${configured ? "text-text-primary" : "text-text-tertiary"}`}
                  >
                    <input
                      type="checkbox"
                      name="providers"
                      value={p.id}
                      defaultChecked={configured}
                      disabled={!configured}
                      className="accent-accent"
                    />
                    {p.displayName}
                    {!configured && " (not configured)"}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-text-secondary">Per-agent budget ($)</label>
              <Input type="number" step="0.01" name="perAgentBudget" defaultValue={30} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-text-secondary">Total budget cap ($)</label>
              <Input type="number" step="0.01" name="totalBudget" defaultValue={90} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-text-secondary">Round cap per phase</label>
              <Input type="number" name="roundCapPerPhase" defaultValue={10} required />
            </div>
          </div>
          <Button type="submit" variant="primary" className="w-full">
            Create run
          </Button>
        </Card>
      </form>
    </div>
  );
}

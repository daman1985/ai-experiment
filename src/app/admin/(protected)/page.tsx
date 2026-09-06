import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROVIDER_REGISTRY } from "@/lib/agents/providerRegistry";
import { createRunAction, startRunAction, pauseRunAction, stopRunAction } from "../actions";

// This reads live run/agent state and requires an authenticated session --
// never prerender it at build time.
export const dynamic = "force-dynamic";

function statusColor(status: string) {
  if (status === "ACTIVE") return "text-green-400";
  if (status === "PAUSED") return "text-yellow-400";
  if (status.startsWith("STOPPED")) return "text-red-400";
  if (status === "COMPLETED") return "text-blue-400";
  return "text-neutral-400";
}

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
        <h1 className="text-xl font-semibold">Runs</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Each run creates one agent per provider you select below, using the model and pricing
          configured in Settings. Starting a run makes it eligible for the cron job to advance --
          nothing happens until the cron tick fires.
        </p>
      </div>

      <div className="space-y-3">
        {runs.length === 0 && <p className="text-sm text-neutral-500">No runs yet.</p>}
        {runs.map((run) => {
          const totalSpend =
            run.agents.reduce((sum, a) => sum + Number(a.spendUsd), 0) + Number(run.systemSpendUsd);
          return (
            <div
              key={run.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{run.name ?? run.id}</span>{" "}
                  <span className={statusColor(run.status)}>{run.status}</span>
                </div>
                <Link href={`/runs/${run.id}`} className="text-neutral-400 hover:underline">
                  View log →
                </Link>
              </div>
              <div className="mt-1 text-neutral-400">
                Phase: {run.currentPhase} · Spend: ${totalSpend.toFixed(4)} / $
                {Number(run.totalBudgetCapUsd).toFixed(2)}
              </div>
              <div className="mt-1 flex gap-3 text-neutral-500">
                {run.agents.map((a) => (
                  <span key={a.id}>
                    {a.displayName}: ${Number(a.spendUsd).toFixed(4)} / $
                    {Number(a.budgetCapUsd).toFixed(2)} {a.isActive ? "" : "(inactive)"}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                {run.status !== "ACTIVE" && !run.status.startsWith("STOPPED") && run.status !== "COMPLETED" && (
                  <form action={startRunAction}>
                    <input type="hidden" name="runId" value={run.id} />
                    <button className="rounded bg-green-900 px-2 py-1 text-xs text-green-200 hover:bg-green-800">
                      Start
                    </button>
                  </form>
                )}
                {run.status === "ACTIVE" && (
                  <form action={pauseRunAction}>
                    <input type="hidden" name="runId" value={run.id} />
                    <button className="rounded bg-yellow-900 px-2 py-1 text-xs text-yellow-200 hover:bg-yellow-800">
                      Pause
                    </button>
                  </form>
                )}
                {(run.status === "ACTIVE" || run.status === "PAUSED") && (
                  <form action={stopRunAction}>
                    <input type="hidden" name="runId" value={run.id} />
                    <button className="rounded bg-red-950 px-2 py-1 text-xs text-red-300 hover:bg-red-900">
                      Stop
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form
        action={createRunAction}
        className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-5"
      >
        <h2 className="font-medium">New run</h2>
        <div>
          <label className="mb-1 block text-sm text-neutral-400">Name (optional)</label>
          <input
            type="text"
            name="name"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-400">
            Participants (pick at least 2)
          </label>
          <div className="flex flex-wrap gap-4">
            {PROVIDER_REGISTRY.map((p) => {
              const configured = configuredIds.has(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 text-sm ${configured ? "" : "text-neutral-600"}`}
                >
                  <input
                    type="checkbox"
                    name="providers"
                    value={p.id}
                    defaultChecked={configured}
                    disabled={!configured}
                  />
                  {p.displayName}
                  {!configured && " (not configured)"}
                </label>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Per-agent budget ($)</label>
            <input
              type="number"
              step="0.01"
              name="perAgentBudget"
              defaultValue={30}
              required
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Total budget cap ($)</label>
            <input
              type="number"
              step="0.01"
              name="totalBudget"
              defaultValue={90}
              required
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Round cap per phase</label>
            <input
              type="number"
              name="roundCapPerPhase"
              defaultValue={10}
              required
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </div>
        </div>
        <button
          type="submit"
          className="w-full rounded bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Create run
        </button>
      </form>
    </div>
  );
}

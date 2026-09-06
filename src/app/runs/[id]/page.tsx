import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Provider } from "@prisma/client";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

const AGENT_COLOR: Record<Provider, string> = {
  ANTHROPIC: "text-orange-300",
  OPENAI: "text-teal-300",
  GOOGLE: "text-blue-300",
};

function fmtUsd(n: number) {
  return `$${n.toFixed(4)}`;
}

export default async function RunViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      agents: { orderBy: { seatIndex: "asc" } },
      turns: {
        orderBy: { sequenceNumber: "asc" },
        include: { agent: true, yieldToAgent: true },
      },
      decisions: { orderBy: { decidedAt: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" }, include: { createdByAgent: true } },
    },
  });
  if (!run) notFound();

  const totalSpend =
    run.agents.reduce((sum, a) => sum + Number(a.spendUsd), 0) + Number(run.systemSpendUsd);

  let lastPhase: string | null = null;

  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <AutoRefresh enabled={run.status === "ACTIVE"} />
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold">{run.name ?? "Untitled run"}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-400">
            <span>Status: {run.status}</span>
            <span>Phase: {run.currentPhase}</span>
            <span>
              Spend: {fmtUsd(totalSpend)} / {fmtUsd(Number(run.totalBudgetCapUsd))}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-sm">
            {run.agents.map((a) => (
              <span key={a.id} className={AGENT_COLOR[a.provider]}>
                {a.displayName}
                {a.assignedRole ? ` (${a.assignedRole})` : ""}: {fmtUsd(Number(a.spendUsd))} / {fmtUsd(Number(a.budgetCapUsd))}
                {!a.isActive && " · inactive"}
              </span>
            ))}
          </div>
        </header>

        {run.decisions.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Decisions
            </h2>
            {run.decisions.map((d) => (
              <div key={d.id} className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm">
                <div className="text-neutral-400">
                  {d.phase} · resolved by {d.method === "CONSENSUS" ? "consensus" : "forced vote"}
                </div>
                <div className="mt-1">{d.outcome}</div>
                {Array.isArray(d.dissent) && d.dissent.length > 0 && (
                  <div className="mt-1 text-xs text-neutral-500">
                    Dissent: {JSON.stringify(d.dissent)}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {run.artifacts.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Artifacts
            </h2>
            {run.artifacts.map((a) => (
              <details key={a.id} className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm">
                <summary className="cursor-pointer">
                  <span className="font-medium">{a.title}</span>{" "}
                  <span className="text-neutral-500">
                    ({a.type}
                    {a.createdByAgent ? ` · ${a.createdByAgent.displayName}` : ""})
                  </span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-neutral-300">{a.content}</pre>
              </details>
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Transcript
          </h2>
          {run.turns.length === 0 && (
            <p className="text-sm text-neutral-500">No turns yet -- start the run to begin.</p>
          )}
          {run.turns.map((t) => {
            const showPhaseHeader = t.phase !== lastPhase;
            lastPhase = t.phase;
            return (
              <div key={t.id}>
                {showPhaseHeader && (
                  <div className="mb-2 mt-6 border-b border-neutral-800 pb-1 text-xs uppercase tracking-wide text-neutral-600">
                    {t.phase}
                  </div>
                )}
                <div className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${AGENT_COLOR[t.agent.provider]}`}>
                      {t.agent.displayName}
                    </span>
                    <span className="text-xs text-neutral-500">
                      round {t.roundNumber + 1}
                      {t.isVote && " · VOTE"}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{t.message}</p>
                  <p className="mt-2 text-xs text-neutral-500">
                    Weakness noted: {t.weaknessCritique}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-600">
                    <span>ready to decide: {t.readyToDecide ? "yes" : "no"}</span>
                    {t.yieldToAgent && <span>yielded to {t.yieldToAgent.displayName}</span>}
                    {t.isVote && t.voteChoice && <span>vote: {t.voteChoice}</span>}
                    <span>{fmtUsd(Number(t.costUsd))}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

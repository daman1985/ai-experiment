import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AutoRefresh } from "./AutoRefresh";
import { AgentAvatar } from "@/components/transcript/AgentAvatar";
import { TurnStepper } from "@/components/transcript/TurnStepper";
import { PhaseDivider } from "@/components/transcript/PhaseDivider";
import { DecisionBreak } from "@/components/transcript/DecisionBreak";
import { TurnRow } from "@/components/transcript/TurnRow";
import { Badge } from "@/components/ui/Badge";
import { AGENT_STYLES } from "@/lib/agents/agentColor";
import { formatPhase, fmtUsd, runStatusVariant } from "@/lib/format";
import type { Phase } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function RunViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      agents: { orderBy: { seatIndex: "asc" } },
      turns: {
        orderBy: { sequenceNumber: "asc" },
        include: { agent: true, yieldToAgent: true, artifacts: true },
      },
      decisions: { orderBy: { decidedAt: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" }, include: { createdByAgent: true, turn: true } },
    },
  });
  if (!run) notFound();

  const totalSpend =
    run.agents.reduce((sum, a) => sum + Number(a.spendUsd), 0) + Number(run.systemSpendUsd);

  const activeAgents = run.agents.filter((a) => a.isActive);
  let currentAgentId: string | null = null;
  if ((run.status === "ACTIVE" || run.status === "PAUSED") && activeAgents.length >= 2) {
    const turnsInPhase = run.turns.filter((t) => t.phase === run.currentPhase).length;
    currentAgentId =
      run.pendingYieldToAgentId ?? activeAgents[turnsInPhase % activeAgents.length].id;
  }

  const agentNameById = new Map(run.agents.map((a) => [a.id, a.displayName]));

  // Decisions render as an inline break in the feed, not a separate
  // section -- see docs/design-system.md, "Decision moment." Merge with
  // turns into one chronological sequence.
  type FeedItem =
    | { kind: "turn"; at: Date; turn: (typeof run.turns)[number] }
    | { kind: "decision"; at: Date; decision: (typeof run.decisions)[number] };
  const feed: FeedItem[] = [
    ...run.turns.map((t): FeedItem => ({ kind: "turn", at: t.createdAt, turn: t })),
    ...run.decisions.map((d): FeedItem => ({ kind: "decision", at: d.decidedAt, decision: d })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const artifactsByPhase = new Map<Phase, typeof run.artifacts>();
  for (const artifact of run.artifacts) {
    const list = artifactsByPhase.get(artifact.phase) ?? [];
    list.push(artifact);
    artifactsByPhase.set(artifact.phase, list);
  }

  let lastPhase: Phase | null = null;

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <AutoRefresh enabled={run.status === "ACTIVE"} />
      <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6">
        <header className="space-y-3 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-serif text-2xl text-text-primary">{run.name ?? "Untitled run"}</h1>
            <TurnStepper agents={activeAgents} currentAgentId={currentAgentId} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
            <span>{formatPhase(run.currentPhase)}</span>
            <span className="tabular-nums">
              {fmtUsd(totalSpend)} / {fmtUsd(Number(run.totalBudgetCapUsd))}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {run.agents.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 text-xs tabular-nums text-text-tertiary"
              >
                <AgentAvatar provider={a.provider} displayName={a.displayName} size="sm" />
                <span className={AGENT_STYLES[a.provider].text}>
                  {a.displayName}
                  {a.assignedRole && ` (${a.assignedRole})`}
                </span>
                : {fmtUsd(Number(a.spendUsd))} / {fmtUsd(Number(a.budgetCapUsd))}
                {!a.isActive && " · inactive"}
              </span>
            ))}
          </div>
        </header>

        <section aria-label="Transcript">
          {feed.length === 0 && (
            <p className="text-sm text-text-tertiary">No turns yet — start the run to begin.</p>
          )}
          {feed.map((item) => {
            const phase = item.kind === "turn" ? item.turn.phase : item.decision.phase;
            const showPhaseHeader = phase !== lastPhase;
            lastPhase = phase;
            const key = item.kind === "turn" ? item.turn.id : item.decision.id;
            return (
              <div key={key}>
                {showPhaseHeader && <PhaseDivider phase={phase} />}
                {item.kind === "turn" ? (
                  <TurnRow turn={item.turn} />
                ) : (
                  <DecisionBreak decision={item.decision} agentNameById={agentNameById} />
                )}
              </div>
            );
          })}
        </section>

        {run.artifacts.length > 0 && (
          <section className="mt-10 space-y-6" aria-label="Artifacts">
            <h2 className="font-serif text-lg text-text-primary">Artifacts</h2>
            {[...artifactsByPhase.entries()].map(([phase, items]) => (
              <div key={phase} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                  {formatPhase(phase)}
                </h3>
                {items.map((a) => (
                  <details key={a.id} className="rounded-md border border-border bg-surface px-3 py-2">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge variant="neutral">{a.type}</Badge>
                          <span className="truncate font-medium text-text-primary">{a.title}</span>
                        </span>
                        {a.turn && (
                          <a
                            href={`#turn-${a.turn.sequenceNumber}`}
                            className="shrink-0 text-xs text-text-tertiary hover:text-accent"
                          >
                            View in transcript &uarr;
                          </a>
                        )}
                      </div>
                      {a.createdByAgent && (
                        <p className="mt-0.5 text-xs text-text-tertiary">
                          by {a.createdByAgent.displayName}
                        </p>
                      )}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap border-t border-border pt-2 font-sans text-sm text-text-secondary">
                      {a.content}
                    </pre>
                  </details>
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { LiveTranscript, NewItemFade } from "@/components/transcript/LiveTranscript";
import { LiveWatchToggle } from "@/components/transcript/LiveWatchToggle";
import { AgentAvatar } from "@/components/transcript/AgentAvatar";
import { TurnStepper } from "@/components/transcript/TurnStepper";
import { DecisionBreak } from "@/components/transcript/DecisionBreak";
import { TurnRow } from "@/components/transcript/TurnRow";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AGENT_STYLES } from "@/lib/agents/agentColor";
import { fmtUsd, runStatusVariant } from "@/lib/format";
import { forceVoteNowAction, extendRoundsAction } from "./actions";

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
    const lastDecision = [...run.decisions].sort(
      (a, b) => b.afterSequenceNumber - a.afterSequenceNumber,
    )[0];
    const turnsSinceDecision = run.turns.filter(
      (t) => t.sequenceNumber > (lastDecision?.afterSequenceNumber ?? 0),
    ).length;
    // Mirrors the rotating-first-speaker formula in lib/agents/engine.ts
    // exactly, so the stepper never drifts from what the next cron tick
    // will actually do.
    const roundNumberForTurn = Math.floor(turnsSinceDecision / activeAgents.length);
    const speakerIndex = (turnsSinceDecision + roundNumberForTurn) % activeAgents.length;
    currentAgentId = run.pendingYieldToAgentId ?? activeAgents[speakerIndex].id;
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

  // Plain, serializable metadata for LiveTranscript to diff between polls
  // -- Turn/Decision carry Prisma Decimal fields that can't cross the
  // server/client boundary as props, so only ids/labels/anchors travel;
  // the actual rendered rows are passed through as `children` instead.
  const feedMeta = feed.map((item) =>
    item.kind === "turn"
      ? {
          id: item.turn.id,
          anchorId: `turn-${item.turn.sequenceNumber}`,
          label: `New turn from ${item.turn.agent.displayName}`,
        }
      : {
          id: item.decision.id,
          anchorId: `decision-${item.decision.id}`,
          label: "Decision reached",
        },
  );

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6">
        <header className="space-y-3 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-serif text-2xl text-text-primary">{run.name ?? "Untitled run"}</h1>
            <TurnStepper agents={activeAgents} currentAgentId={currentAgentId} />
          </div>
          <p className="text-sm text-text-secondary">{run.topic}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
            <span className="tabular-nums">
              {fmtUsd(totalSpend)} / {fmtUsd(Number(run.totalBudgetCapUsd))}
            </span>
            {run.status === "ACTIVE" && <LiveWatchToggle runId={run.id} />}
          </div>
          {(run.status === "ACTIVE" || run.status === "COMPLETED") && (
            <div className="flex flex-wrap items-center gap-2">
              {run.status === "ACTIVE" && !run.forcedVotePending && (
                <form action={forceVoteNowAction}>
                  <input type="hidden" name="runId" value={run.id} />
                  <Button type="submit" variant="secondary" className="px-2 py-1 text-xs">
                    Force a decision now
                  </Button>
                </form>
              )}
              {(run.status === "COMPLETED" || run.forcedVotePending) && (
                <form action={extendRoundsAction}>
                  <input type="hidden" name="runId" value={run.id} />
                  <Button type="submit" variant="secondary" className="px-2 py-1 text-xs">
                    {run.status === "COMPLETED"
                      ? `Reopen — continue ${run.forcedVoteRoundCap} more rounds`
                      : `Cancel vote — continue ${run.forcedVoteRoundCap} more rounds`}
                  </Button>
                </form>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {run.agents.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 text-xs tabular-nums text-text-tertiary"
              >
                <AgentAvatar provider={a.provider} displayName={a.displayName} size="sm" />
                <span className={AGENT_STYLES[a.provider].text}>{a.displayName}</span>
                {`: ${fmtUsd(Number(a.spendUsd))} / ${fmtUsd(Number(a.budgetCapUsd))}`}
                {!a.isActive && " · inactive"}
              </span>
            ))}
          </div>
        </header>

        <LiveTranscript enabled={run.status === "ACTIVE"} items={feedMeta}>
          <section aria-label="Transcript" role="feed">
            {feed.length === 0 && (
              <p className="text-sm text-text-tertiary">No turns yet — start the run to begin.</p>
            )}
            {feed.map((item, index) => {
              const key = item.kind === "turn" ? item.turn.id : item.decision.id;
              // Roving tabindex + the ARIA "feed" pattern's aria-posinset/
              // aria-setsize -- see docs/design-system.md, "Long-transcript
              // performance/accessibility." Only the first item starts as
              // the tab stop; LiveTranscript keeps this correct afterward
              // as focus moves.
              const posinset = index + 1;
              const setsize = feed.length;
              const tabIndex = index === 0 ? 0 : -1;
              return (
                <div key={key}>
                  <NewItemFade>
                    {item.kind === "turn" ? (
                      <TurnRow
                        turn={item.turn}
                        tabIndex={tabIndex}
                        posinset={posinset}
                        setsize={setsize}
                      />
                    ) : (
                      <DecisionBreak
                        decision={item.decision}
                        agentNameById={agentNameById}
                        tabIndex={tabIndex}
                        posinset={posinset}
                        setsize={setsize}
                      />
                    )}
                  </NewItemFade>
                </div>
              );
            })}
          </section>
        </LiveTranscript>

        {run.artifacts.length > 0 && (
          <section className="mt-10 space-y-2" aria-label="Artifacts">
            <h2 className="font-serif text-lg text-text-primary">Artifacts</h2>
            {run.artifacts.map((a) => (
              <details key={a.id} className="rounded-md border border-border bg-surface px-3 py-2">
                <summary className="cursor-pointer list-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant="neutral">{a.type}</Badge>
                      <span className="truncate font-medium text-text-primary">{a.title}</span>
                    </span>
                    {a.turn && (
                      <a
                        href={`#turn-${a.turn.sequenceNumber}`}
                        className="shrink-0 rounded-sm text-xs text-text-tertiary outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
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
          </section>
        )}
      </div>
    </div>
  );
}

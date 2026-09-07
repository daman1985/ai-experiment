import type { Agent, Artifact, Turn } from "@prisma/client";
import { AgentAvatar } from "./AgentAvatar";
import { ArtifactInlinePreview } from "./ArtifactInlinePreview";
import { Badge } from "@/components/ui/Badge";
import { AGENT_STYLES } from "@/lib/agents/agentColor";
import { fmtUsd } from "@/lib/format";

type TurnWithRelations = Turn & {
  agent: Agent;
  yieldToAgent: Agent | null;
  artifacts: Artifact[];
};

interface ToolCallEntry {
  query: string;
  resultSummary: string;
}

function isToolCallArray(value: unknown): value is ToolCallEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v): v is ToolCallEntry =>
        typeof v === "object" && v !== null && "query" in v && "resultSummary" in v,
    )
  );
}

// One row in the continuous transcript surface -- deliberately not a
// card (see docs/design-system.md's explicit rejection of "a card for
// every single message"). The avatar column stays at a fixed left edge
// across every row so a long reading session doesn't require re-finding
// where the message content starts.
//
// `tabIndex`/`posinset`/`setsize` implement the roving-tabindex ARIA
// "feed" pattern from docs/design-system.md's "Long-transcript
// performance/accessibility" -- one row is a tab stop at a time, the
// rest are `-1`, with `aria-posinset`/`aria-setsize` so a screen reader
// still understands the true document length once this is virtualized.
export function TurnRow({
  turn,
  tabIndex,
  posinset,
  setsize,
}: {
  turn: TurnWithRelations;
  tabIndex: number;
  posinset: number;
  setsize: number;
}) {
  const styles = AGENT_STYLES[turn.agent.provider];
  const toolCalls = isToolCallArray(turn.toolCalls) ? turn.toolCalls : [];
  const hasStatus =
    turn.readyToDecide || turn.runComplete || turn.yieldToAgent || turn.isVote || toolCalls.length > 0;

  return (
    <div
      id={`turn-${turn.sequenceNumber}`}
      role="article"
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-label={`${turn.agent.displayName}, round ${turn.roundNumber + 1}`}
      tabIndex={tabIndex}
      className={`border-b border-l-2 border-border px-4 py-4 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${styles.rowBg} ${styles.rowBorder}`}
    >
      <div className="grid grid-cols-[2rem_1fr] gap-3">
        <AgentAvatar provider={turn.agent.provider} displayName={turn.agent.displayName} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className={`text-sm font-semibold ${styles.text}`}>{turn.agent.displayName}</span>
            <span className="tabular-nums text-xs text-text-tertiary">
              round {turn.roundNumber + 1} &middot; confidence{" "}
              {turn.confidenceBeforePeerUpdate.toFixed(2)}&rarr;
              {turn.confidenceAfterPeerUpdate.toFixed(2)} &middot; {fmtUsd(Number(turn.costUsd))}
            </span>
          </div>

          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
            {turn.message}
          </p>

          <div
            className={`mt-3 border-l-2 pl-3 text-sm italic leading-snug text-text-secondary ${styles.ruleBorder}`}
          >
            {turn.weaknessCritique}
          </div>

          {hasStatus && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {turn.readyToDecide && <Badge variant="success">Ready to decide</Badge>}
              {turn.runComplete && <Badge variant="success">Believes topic resolved</Badge>}
              {turn.yieldToAgent && (
                <Badge variant="neutral">Yielded to {turn.yieldToAgent.displayName}</Badge>
              )}
              {turn.isVote && (
                <Badge variant="warning">Vote{turn.voteChoice ? `: ${turn.voteChoice}` : ""}</Badge>
              )}
              {toolCalls.length > 0 && <Badge variant="neutral">Searched</Badge>}
            </div>
          )}

          {toolCalls.length > 0 && (
            <details className="mt-2 text-xs text-text-tertiary">
              <summary className="cursor-pointer select-none outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent">
                {toolCalls.length} search{toolCalls.length > 1 ? "es" : ""} this turn
              </summary>
              <ul className="mt-1 space-y-1 pl-3">
                {toolCalls.map((tc, i) => (
                  <li key={i}>
                    <span className="text-text-secondary">&ldquo;{tc.query}&rdquo;</span>
                    {tc.resultSummary && <> &mdash; {tc.resultSummary}</>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {turn.artifacts.map((artifact) => (
            <ArtifactInlinePreview key={artifact.id} artifact={artifact} />
          ))}
        </div>
      </div>
    </div>
  );
}

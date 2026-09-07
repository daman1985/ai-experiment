import type { Decision } from "@prisma/client";
import { Badge } from "@/components/ui/Badge";

interface DissentEntry {
  agentId: string;
  reason: string;
}

function isDissentArray(value: unknown): value is DissentEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v): v is DissentEntry =>
        typeof v === "object" && v !== null && "agentId" in v && "reason" in v,
    )
  );
}

// The one deliberate interruption of the normal turn rhythm -- a
// chapter-divider moment marking that something resolved. See
// docs/design-system.md, "Decision moment."
export function DecisionBreak({
  decision,
  agentNameById,
  tabIndex,
  posinset,
  setsize,
}: {
  decision: Decision;
  agentNameById: Map<string, string>;
  tabIndex: number;
  posinset: number;
  setsize: number;
}) {
  const dissent = isDissentArray(decision.dissent) ? decision.dissent : [];
  const methodLabel = decision.method === "CONSENSUS" ? "Consensus" : "Forced vote";

  return (
    <div
      id={`decision-${decision.id}`}
      role="article"
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-label={`Decision reached: ${methodLabel}`}
      tabIndex={tabIndex}
      className="my-8 border-y border-border bg-surface-hover px-4 py-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-serif text-lg text-text-primary">Decision reached</span>
        <Badge variant={decision.method === "CONSENSUS" ? "success" : "warning"}>
          {methodLabel}
        </Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
        {decision.outcome}
      </p>
      <div className="mt-3 border-l-2 border-border pl-3 text-sm italic leading-snug text-text-secondary">
        <span className="not-italic font-medium text-text-primary">Untested: </span>
        {decision.untestedAssumption} <span className="not-italic font-medium text-text-primary">If wrong: </span>
        {decision.likelyFailureMode}
      </div>
      {dissent.length > 0 && (
        <div className="mt-3 space-y-1 border-l-2 border-border pl-3">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            Dissent
          </p>
          {dissent.map((d, i) => (
            <p key={i} className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">
                {agentNameById.get(d.agentId) ?? "Unknown"}:
              </span>{" "}
              {d.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

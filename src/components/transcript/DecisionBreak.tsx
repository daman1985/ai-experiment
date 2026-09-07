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
}: {
  decision: Decision;
  agentNameById: Map<string, string>;
}) {
  const dissent = isDissentArray(decision.dissent) ? decision.dissent : [];

  return (
    <div className="my-8 border-y border-border bg-surface-hover px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-serif text-lg text-text-primary">Decision reached</span>
        <Badge variant={decision.method === "CONSENSUS" ? "success" : "warning"}>
          {decision.method === "CONSENSUS" ? "Consensus" : "Forced vote"}
        </Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
        {decision.outcome}
      </p>
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

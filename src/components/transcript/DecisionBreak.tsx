import type { Decision, ExpertAudit } from "@prisma/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { runExpertAuditAction } from "@/app/runs/[id]/actions";

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const VERDICT_VARIANT = {
  PASS: "success",
  MIXED: "warning",
  FAIL: "error",
} as const;

// A collapsed-by-default deep-dive into one decision, run on demand by an
// admin, by a model that never participated in the deliberation -- see
// lib/agents/expertAudit.ts. Kept visually secondary to the decision
// itself (this is scrutiny of the process, not part of the room's own
// output) via <details> rather than always-open.
function ExpertAuditPanel({ audit }: { audit: ExpertAudit }) {
  const fatalFlaws = isStringArray(audit.fatalFlaws) ? audit.fatalFlaws : [];
  const residualLoss = isStringArray(audit.residualLossDetected) ? audit.residualLossDetected : [];
  const productGaps = isStringArray(audit.productGaps) ? audit.productGaps : [];

  return (
    <details className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <summary className="cursor-pointer list-none outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="flex items-center gap-2">
          <Badge variant={VERDICT_VARIANT[audit.verdict]}>Expert audit: {audit.verdict}</Badge>
          <span className="text-xs text-text-tertiary">{audit.verdictRationale}</span>
        </span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-border pt-3 text-text-secondary">
        {fatalFlaws.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
              Fatal flaws
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {fatalFlaws.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {residualLoss.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
              Residual loss detected
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {residualLoss.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: "Exploration", score: audit.explorationGainScore, note: audit.explorationGainNote },
            { label: "Information", score: audit.informationGainScore, note: audit.informationGainNote },
            { label: "Aggregation", score: audit.aggregationGainScore, note: audit.aggregationGainNote },
          ].map((d) => (
            <div key={d.label} className="rounded-sm border border-border p-2">
              <p className="text-xs font-medium text-text-primary">
                {d.label} <span className="tabular-nums text-text-tertiary">{d.score}/10</span>
              </p>
              <p className="mt-0.5 text-xs text-text-tertiary">{d.note}</p>
            </div>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            Red-team injection
          </p>
          <p className="mt-1">{audit.redTeamInjection}</p>
        </div>
        {productGaps.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
              Product gaps this exposed
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {productGaps.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            Top recommendation
          </p>
          <p className="mt-1 font-medium text-text-primary">{audit.topRecommendation}</p>
        </div>
      </div>
    </details>
  );
}

// The one deliberate interruption of the normal turn rhythm -- a
// chapter-divider moment marking that something resolved. See
// docs/design-system.md, "Decision moment."
export function DecisionBreak({
  decision,
  audit,
  agentNameById,
  tabIndex,
  posinset,
  setsize,
}: {
  decision: Decision;
  audit: ExpertAudit | null;
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
      {audit ? (
        <ExpertAuditPanel audit={audit} />
      ) : (
        <form action={runExpertAuditAction} className="mt-4">
          <input type="hidden" name="decisionId" value={decision.id} />
          <Button type="submit" variant="secondary" className="px-2 py-1 text-xs">
            Run expert audit
          </Button>
        </form>
      )}
    </div>
  );
}

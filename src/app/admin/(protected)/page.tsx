import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROVIDER_REGISTRY } from "@/lib/agents/providerRegistry";
import { createRunAction, startRunAction, pauseRunAction, stopRunAction } from "../actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fmtUsd, runStatusVariant } from "@/lib/format";

// This reads live run/agent state and requires an authenticated session --
// never prerender it at build time.
export const dynamic = "force-dynamic";

// Pre-filled starting point for the New Run form -- the original
// business-founding template, now just the default rather than the only
// option. Any field here is editable before creating the run, and the
// two trailing slots start empty for a topic that wants more (or fewer)
// stages. See docs/design-system.md and RunPhase in schema.prisma.
const PHASE_TEMPLATE_DEFAULTS = [
  {
    name: "Ideation",
    guidance:
      "Decide what to pursue given the topic. Propose and critique ideas. Ground claims in something real when you can -- you have a research tool for exactly this reason. A known trap in every prior experiment like this one is converging on something that's demo-able rather than something with real, unmet demand, or picking an idea that's already a free feature of some major platform. Actively argue against that trap rather than defaulting to the first idea that sounds plausible. Only set readyToDecide to true once you'd defend the choice against a skeptical outsider, not just against each other.",
    assignsRoles: false,
    allowsResearch: true,
  },
  {
    name: "Role assignment",
    guidance:
      "Decide who takes which role given what was chosen in the prior phase. Propose role structures and justify them based on the actual skills needed, not on who suggested it. Disagree openly if a proposed assignment doesn't hold up.",
    assignsRoles: true,
    allowsResearch: true,
  },
  {
    name: "Operation",
    guidance:
      "Decide and execute on whatever comes next. Remember the boundary below -- draft anything you want (outreach messages, marketing copy, plans) but nothing you produce here is ever sent to a real person or business.",
    assignsRoles: false,
    allowsResearch: false,
  },
];
const MAX_PHASE_SLOTS = 5;

export default async function AdminDashboard() {
  const runs = await prisma.run.findMany({
    orderBy: { createdAt: "desc" },
    include: { agents: true, phases: { orderBy: { orderIndex: "asc" } } },
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
          const currentPhase = run.phases.find((p) => p.orderIndex === run.currentPhaseIndex);
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
              <p className="mt-1 truncate text-text-tertiary">{run.topic}</p>
              <div className="mt-2 tabular-nums text-text-secondary">
                {currentPhase && <>Phase: {currentPhase.name} &middot; </>}
                Spend: {fmtUsd(totalSpend)} / {fmtUsd(Number(run.totalBudgetCapUsd))}
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
            <label className="mb-1 block text-sm text-text-secondary">Topic</label>
            <Textarea
              name="topic"
              rows={2}
              required
              defaultValue="Decide what business to start, then who does what, then run it."
              placeholder="What should the room discuss? Any topic works -- not just business ideas."
            />
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-text-secondary">Per-agent budget ($)</label>
              <Input type="number" step="0.01" name="perAgentBudget" defaultValue={30} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-text-secondary">Total budget cap ($)</label>
              <Input type="number" step="0.01" name="totalBudget" defaultValue={90} required />
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div>
              <label className="block text-sm text-text-secondary">Phases</label>
              <p className="mt-0.5 text-xs text-text-tertiary">
                The room resolves phases in order, each ending in a decision. Pre-filled with the
                original business-founding template below -- edit or clear any of it for a
                different topic. Leave a phase&apos;s name blank to skip it.
              </p>
            </div>
            {Array.from({ length: MAX_PHASE_SLOTS }, (_, i) => i + 1).map((slot) => {
              const template = PHASE_TEMPLATE_DEFAULTS[slot - 1];
              return (
                <div key={slot} className="space-y-2 rounded-md border border-border p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                    <div>
                      <label className="mb-1 block text-xs text-text-tertiary">
                        Phase {slot} name{!template && " (optional)"}
                      </label>
                      <Input
                        type="text"
                        name={`phase${slot}Name`}
                        defaultValue={template?.name ?? ""}
                        placeholder={template ? undefined : "Leave blank to skip this slot"}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-text-tertiary">Round cap</label>
                      <Input
                        type="number"
                        name={`phase${slot}RoundCap`}
                        defaultValue={10}
                        className="sm:w-24"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-tertiary">Guidance</label>
                    <Textarea
                      name={`phase${slot}Guidance`}
                      rows={2}
                      defaultValue={template?.guidance ?? ""}
                      placeholder="What should agents do during this phase?"
                    />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        name={`phase${slot}AssignsRoles`}
                        defaultChecked={template?.assignsRoles ?? false}
                        className="accent-accent"
                      />
                      Extract per-agent role assignments on consensus
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        name={`phase${slot}AllowsResearch`}
                        defaultChecked={template?.allowsResearch ?? true}
                        className="accent-accent"
                      />
                      Allow web search during this phase
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="submit" variant="primary" className="w-full">
            Create run
          </Button>
        </Card>
      </form>
    </div>
  );
}

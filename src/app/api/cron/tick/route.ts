import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { advanceRun, MIN_TURN_BUDGET_MS } from "@/lib/agents/engine";
import { logDiagnostic } from "@/lib/diagnostics";

// One tick = one turn (or one budget/consensus housekeeping step) for
// every currently ACTIVE run. Vercel Cron calls this on the schedule in
// vercel.json and sends `Authorization: Bearer ${CRON_SECRET}` -- see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
// A turn can involve two LLM calls (research + structured output) plus a
// live web search, so this is given real headroom rather than the
// platform's 10s default. Confirmed directly against production with the
// app's actual prompts (not placeholder content) that a real research
// call can legitimately take ~35s -- 60s was never actually enough for a
// single real turn, let alone more than one. The turn call itself now has
// up to 60s of its own (raised from ~24s worst-observed once
// TURN_MAX_TOKENS doubled to stop mid-JSON truncation -- see
// providers/anthropic.ts), not counting a possible consensus-extraction
// chain immediately afterward (another ~50s worst case). Still comfortably
// above one full research+turn (~100s) with margin to spare, so this
// doesn't need to move with that bump -- see
// MIN_TURN_BUDGET_MS/MIN_EXTRACTION_BUDGET_MS in engine.ts, which this
// deadline math is kept in sync with.
export const maxDuration = 150;
export const dynamic = "force-dynamic";

// Confirmed directly against a real production tick: two active runs
// processed sequentially in one invocation genuinely can, and did, blow
// past this route's (then 60s) maxDuration -- the first run's Anthropic
// call correctly hit its own controlled timeout (withTimeout working as
// designed), but that left too little of the budget for the second run,
// which then got hard-killed by the platform instead of its own timeout.
// A per-run *fresh* budget check (the earlier TICK_BUDGET_MS approach)
// doesn't prevent this: what matters is how much of the *one shared*
// deadline is left, not a local guess. deadlineAt is that one shared
// deadline, threaded through advanceRun so every step (starting a turn,
// or attempting a decision's extraction calls) checks against the same
// absolute cutoff rather than assuming a fresh allotment. Margin below
// the actual hard kill for response/serialization overhead.
const DEADLINE_MARGIN_MS = 5_000;

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickStart = Date.now();
  const deadlineAt = tickStart + maxDuration * 1000 - DEADLINE_MARGIN_MS;
  // Least-recently-attempted first (never-attempted runs sort first of
  // all) -- confirmed necessary directly from production: without this,
  // a run whose turn call keeps timing out stays first in a naive
  // query-order every tick and permanently starves every other active
  // run sharing this tick's deadline, since they never even get
  // attempted. This guarantees every run gets its own attempt before a
  // repeatedly-failing one is retried.
  const activeRuns = await prisma.run.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: { lastTickAttemptedAt: { sort: "asc", nulls: "first" } },
  });
  await logDiagnostic({
    source: "cron/tick",
    level: "info",
    message: `starting, ${activeRuns.length} active run(s)`,
    detail: { runIds: activeRuns.map((r) => r.id) },
  });

  const results = [];
  for (const run of activeRuns) {
    const runStart = Date.now();
    if (deadlineAt - runStart < MIN_TURN_BUDGET_MS) {
      await logDiagnostic({
        source: "cron/tick",
        level: "info",
        runId: run.id,
        message: "stopping early, not enough of the shared deadline left -- deferring to the next tick",
      });
      results.push({ runId: run.id, action: "deferred" as const, detail: "tick budget exhausted" });
      continue;
    }
    await logDiagnostic({
      source: "cron/tick",
      level: "info",
      runId: run.id,
      message: `advancing (+${runStart - tickStart}ms since tick start)`,
    });
    try {
      // Recorded before the call, not after -- an attempt that throws or
      // times out still counts as "attempted" for fairness-ordering
      // purposes; only a run this tick never got to (see the deferred
      // branch above) should keep its place at the front of the queue.
      await prisma.run.update({ where: { id: run.id }, data: { lastTickAttemptedAt: new Date() } });
      const result = await advanceRun(run.id, deadlineAt);
      await logDiagnostic({
        source: "cron/tick",
        level: "info",
        runId: run.id,
        message: `done in ${Date.now() - runStart}ms`,
        detail: result,
      });
      results.push({ runId: run.id, ...result });
    } catch (err) {
      await logDiagnostic({
        source: "cron/tick",
        level: "error",
        runId: run.id,
        message: `threw after ${Date.now() - runStart}ms: ${err instanceof Error ? err.message : String(err)}`,
      });
      results.push({
        runId: run.id,
        action: "error" as const,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await logDiagnostic({
    source: "cron/tick",
    level: "info",
    message: `all done in ${Date.now() - tickStart}ms`,
  });
  return NextResponse.json({ tickedRuns: results.length, results });
}

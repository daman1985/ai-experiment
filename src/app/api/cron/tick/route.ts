import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { advanceRun } from "@/lib/agents/engine";

// One tick = one turn (or one budget/consensus housekeeping step) for
// every currently ACTIVE run. Vercel Cron calls this on the schedule in
// vercel.json and sends `Authorization: Bearer ${CRON_SECRET}` -- see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
// A turn can involve two LLM calls (research + structured output) plus a
// live web search, so this is given real headroom rather than the
// platform's 10s default.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
  const activeRuns = await prisma.run.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  // TEMPORARY: diagnosing repeated 60s timeouts on this route. Every
  // active run is processed sequentially in one invocation -- if there
  // are several, or if one call hangs, this is exactly how the whole
  // tick blows its budget. Timestamps land in Vercel's runtime logs even
  // if the function is later killed mid-loop, so this pinpoints where.
  console.log(
    `[cron/tick] starting, ${activeRuns.length} active run(s): ${activeRuns.map((r) => r.id).join(", ")}`,
  );

  const results = [];
  for (const run of activeRuns) {
    const runStart = Date.now();
    console.log(`[cron/tick] advancing ${run.id} (+${runStart - tickStart}ms since tick start)`);
    try {
      const result = await advanceRun(run.id);
      console.log(
        `[cron/tick] ${run.id} done in ${Date.now() - runStart}ms: ${JSON.stringify(result)}`,
      );
      results.push({ runId: run.id, ...result });
    } catch (err) {
      console.log(
        `[cron/tick] ${run.id} threw after ${Date.now() - runStart}ms: ${err instanceof Error ? err.stack : String(err)}`,
      );
      results.push({
        runId: run.id,
        action: "error" as const,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`[cron/tick] all done in ${Date.now() - tickStart}ms`);
  return NextResponse.json({ tickedRuns: results.length, results });
}

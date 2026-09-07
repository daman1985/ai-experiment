"use server";

import { advanceRun } from "@/lib/agents/engine";

// Lets an admin watching this run's page pump it forward faster than the
// 10-minute cron cadence, without changing the cron schedule itself --
// see LiveWatchToggle. Reuses the exact same advanceRun the cron route
// calls (including its overlap lock), so this can never take a turn out
// of turn or double up with a cron tick that fires at the same moment.
// Gated by the same admin session as the rest of /runs/:path* (see
// src/proxy.ts) since this executes against the current page's route.
export async function advanceRunNowAction(runId: string): Promise<void> {
  await advanceRun(runId);
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
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

// Skips straight to a forced vote instead of waiting for the round cap --
// the room resolves this specific disagreement on the next round rather
// than the admin needing to wait out however many rounds are left.
export async function forceVoteNowAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId"));
  await prisma.run.updateMany({
    where: { id: runId, status: "ACTIVE" },
    data: { forcedVotePending: true },
  });
  revalidatePath(`/runs/${runId}`);
}

// The other half of "force a decision now": give the room a fresh
// round-cap window from this exact moment. Same action whether it's
// cancelling an about-to-happen forced vote (the room wasn't actually
// stuck, just running long) or reopening a run that already completed
// (runComplete fired -- see prompt.ts -- when the topic wasn't really
// finished) -- both just mean "keep going," so both reduce to the same
// three fields: status back to ACTIVE, the forced-vote flag cleared, and
// the round-cap clock reset to now via extendedAtSequenceNumber.
export async function extendRoundsAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId"));
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  // Only meaningful for a run that's still going (cancelling an
  // about-to-happen vote) or one that just wrapped up (reopening it) --
  // a manually stopped or budget-exhausted run needs a real decision to
  // resume, not this button.
  if (!run || (run.status !== "ACTIVE" && run.status !== "COMPLETED")) return;

  const maxSeq = await prisma.turn.aggregate({
    where: { runId },
    _max: { sequenceNumber: true },
  });
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: "ACTIVE",
      endedAt: null,
      forcedVotePending: false,
      pendingYieldToAgentId: null,
      roundNumber: 0,
      extendedAtSequenceNumber: maxSeq._max.sequenceNumber ?? 0,
    },
  });
  revalidatePath(`/runs/${runId}`);
}

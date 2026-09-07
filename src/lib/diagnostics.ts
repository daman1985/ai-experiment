import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Writes a row to DiagnosticEvent (see schema.prisma) so the in-app
// /admin/diagnostics page can show it -- the whole point being that
// whoever runs this app can open a page and copy what it shows, instead
// of needing someone with Vercel dashboard/API access to pull logs on
// their behalf every time something needs checking. Never throws: a
// logging failure must never break the actual operation it's observing,
// so a DB hiccup here is swallowed (and still reported to Vercel's own
// console, which remains a fallback).
export async function logDiagnostic(params: {
  source: string;
  level: "info" | "error";
  runId?: string;
  message: string;
  detail?: unknown;
}): Promise<void> {
  console.log(`[${params.source}] ${params.message}`, params.detail ?? "");
  try {
    await prisma.diagnosticEvent.create({
      data: {
        source: params.source,
        level: params.level,
        runId: params.runId,
        message: params.message,
        detail:
          params.detail !== undefined
            ? (JSON.parse(JSON.stringify(params.detail)) as Prisma.InputJsonValue)
            : undefined,
      },
    });
  } catch (err) {
    console.error("[diagnostics] failed to record event", err);
  }
}

// For writing several related events at once (e.g. every result from
// one diagnostic battery run) without either serializing N round-trips
// (slow, and can eat into a tight remaining time budget) or firing them
// with Promise.all (fast, but loses ordering -- concurrent writes can
// commit in a different order than the array, and the page displays
// newest-first by createdAt, so a reordered batch renders confusingly
// out of the sequence it was reasoned about in). One batched insert,
// with each row's createdAt explicitly incremented by array index, gets
// both: a single fast round-trip and a guaranteed, deterministic
// display order matching the array.
export async function logDiagnosticBatch(
  entries: { source: string; level: "info" | "error"; runId?: string; message: string; detail?: unknown }[],
): Promise<void> {
  const now = Date.now();
  for (const e of entries) console.log(`[${e.source}] ${e.message}`, e.detail ?? "");
  try {
    await prisma.diagnosticEvent.createMany({
      data: entries.map((e, i) => ({
        source: e.source,
        level: e.level,
        runId: e.runId,
        message: e.message,
        detail:
          e.detail !== undefined ? (JSON.parse(JSON.stringify(e.detail)) as Prisma.InputJsonValue) : undefined,
        // Same-millisecond writes would otherwise tie under
        // orderBy: createdAt desc, leaving display order to whatever
        // the DB does with ties -- the explicit offset guarantees the
        // array's own order survives into the display.
        createdAt: new Date(now + i),
      })),
    });
  } catch (err) {
    console.error("[diagnostics] failed to record event batch", err);
  }
}

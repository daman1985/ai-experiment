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

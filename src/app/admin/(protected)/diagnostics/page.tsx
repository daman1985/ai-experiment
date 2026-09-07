import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { runRealPromptCheckAction, clearDiagnosticsAction } from "./actions";

export const dynamic = "force-dynamic";
// The "run diagnostic call" action below fires a full battery of real
// Anthropic calls in parallel, each with its own 20s abort -- needs more
// than the platform's default route timeout to avoid the action itself
// getting killed before every check has a chance to finish or abort
// cleanly, plus a little more for the sequential logging afterward.
export const maxDuration = 45;

const MAX_EVENTS = 400;

function formatLine(e: {
  createdAt: Date;
  source: string;
  level: string;
  runId: string | null;
  message: string;
  detail: unknown;
}): string {
  const time = e.createdAt.toISOString();
  const level = e.level.toUpperCase().padEnd(5);
  const run = e.runId ? ` run=${e.runId}` : "";
  const detail =
    e.detail && typeof e.detail === "object" && Object.keys(e.detail).length > 0
      ? ` | ${JSON.stringify(e.detail)}`
      : "";
  return `${time} [${level}] ${e.source}${run}: ${e.message}${detail}`;
}

// A plain, copy-pasteable operational log -- the point of this page is
// that whoever runs this app can open it and copy what it shows directly
// into a conversation for help troubleshooting, without anyone needing
// Vercel dashboard/API access to pull logs on their behalf. Written by
// the actual code paths being debugged (cron/tick, each provider
// adapter's research/turn calls, decision extraction) -- see
// lib/diagnostics.ts for the write path.
export default async function DiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ runId?: string; level?: string }>;
}) {
  const { runId, level } = await searchParams;

  const events = await prisma.diagnosticEvent.findMany({
    where: {
      ...(runId ? { runId } : {}),
      ...(level ? { level } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_EVENTS,
  });

  const errorCount = events.filter((e) => e.level === "error").length;
  const text = events.map(formatLine).join("\n");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-text-primary">Diagnostics</h1>
        <p className="mt-1 text-sm text-text-secondary">
          The most recent {events.length} events (newest first, capped at {MAX_EVENTS} -- older
          events may exist beyond that). Written directly by the cron tick, each provider call,
          and decision extraction -- select the text below and copy to share for troubleshooting.
          Updates automatically after either button below finishes; reload manually for events
          from something else (like a cron tick) that landed since this page loaded.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <Badge variant={errorCount > 0 ? "error" : "success"}>
            {errorCount} error{errorCount === 1 ? "" : "s"} in view
          </Badge>
          {runId && <Badge variant="accent">filtered to run {runId}</Badge>}
          {level && <Badge variant="accent">level={level}</Badge>}
          {(runId || level) && (
            <a href="/admin/diagnostics" className="text-accent hover:underline">
              clear filters
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <form action={runRealPromptCheckAction}>
          <SubmitButton variant="secondary" className="px-3 py-1 text-xs" pendingText="Running (up to ~20s)...">
            Run full diagnostic battery
          </SubmitButton>
        </form>
        <form action={clearDiagnosticsAction}>
          <ConfirmSubmitButton
            variant="danger"
            className="px-3 py-1 text-xs"
            pendingText="Clearing..."
            confirmMessage="Clear every recorded diagnostic event? This can't be undone."
          >
            Clear log
          </ConfirmSubmitButton>
        </form>
      </div>
      <p className="text-xs text-text-tertiary">
        &quot;Run full diagnostic battery&quot; fires several real Anthropic calls in parallel
        against the configured key to isolate exactly what's causing a hang -- takes up to ~20
        seconds; results appear below automatically once it finishes. &quot;Clear log&quot;
        deletes every recorded event so far, so the next run's output isn't mixed in with old
        ticks/errors -- it doesn't affect the app itself, only this log.
      </p>

      <form className="flex flex-wrap gap-2 text-sm" action="/admin/diagnostics">
        <div className="w-56">
          <Input
            type="text"
            name="runId"
            defaultValue={runId ?? ""}
            placeholder="Filter by run id..."
            aria-label="Filter by run id"
            className="px-2 py-1 text-xs"
          />
        </div>
        <select
          name="level"
          defaultValue={level ?? ""}
          aria-label="Filter by level"
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
        >
          <option value="">all levels</option>
          <option value="info">info</option>
          <option value="error">error</option>
        </select>
        <Button type="submit" variant="secondary" className="px-3 py-1 text-xs">
          Filter
        </Button>
      </form>

      <pre className="h-[70vh] w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-text-primary">
        {events.length === 0 ? "(no events recorded yet)" : text}
      </pre>
    </div>
  );
}

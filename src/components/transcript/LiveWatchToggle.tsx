"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceRunNowAction } from "@/app/runs/[id]/actions";
import { Badge } from "@/components/ui/Badge";

// Gap between one advance call finishing and the next one starting --
// paces off the actual turn latency (a self-scheduling loop) rather than
// firing on a fixed timer regardless of overlap, since a turn with a web
// search can take much longer than a plain one.
const POLL_DELAY_MS = 2000;
// How often to re-check whether the tab has come back into view while
// paused. Not the same knob as POLL_DELAY_MS -- this never triggers an
// actual advance, just a cheap visibility check.
const HIDDEN_RECHECK_MS = 2000;

// Opt-in accelerant for when the admin is actually watching a run: while
// on, this pumps the run forward via the same advanceRun the cron tick
// uses, roughly every couple of seconds instead of every 10 minutes.
// There is no server-side "live mode" to turn back off -- leaving the
// page (unmount) or flipping the checkbox both just stop this component's
// own loop, and the run falls straight back to whatever the cron
// schedule already provides, which never stopped running underneath it.
export function LiveWatchToggle({ runId }: { runId: string }) {
  const [watching, setWatching] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!watching) {
      setLastError(null);
      return;
    }
    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        // Paused while the tab is backgrounded -- a forgotten tab left
        // checked must never keep spending real API budget or hammering
        // the database unattended. Resumes the moment it's visible again.
        if (document.visibilityState !== "visible") {
          await new Promise((resolve) => setTimeout(resolve, HIDDEN_RECHECK_MS));
          continue;
        }
        try {
          await advanceRunNowAction(runId);
          if (!cancelled) setLastError(null);
        } catch (err) {
          // Previously swallowed entirely with no UI feedback -- a
          // transient provider/network error shouldn't kill live mode, so
          // this still just keeps pacing and lets the next call retry,
          // but the admin needs to be able to tell "still working" apart
          // from "checked the box and nothing is happening."
          if (!cancelled) {
            setLastError(err instanceof Error ? err.message : "Advance attempt failed.");
          }
        }
        if (cancelled) return;
        router.refresh();
        await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
      }
    }
    loop();

    return () => {
      cancelled = true;
    };
  }, [watching, runId, router]);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={watching}
          onChange={(e) => setWatching(e.target.checked)}
          className="accent-accent"
        />
        Watch live
        <span className="text-text-tertiary">
          (advances every couple seconds while this tab is open and visible -- real spend, same as
          any turn; pauses automatically if you switch away)
        </span>
      </label>
      {watching && lastError && (
        // role="status" (polite), not "alert" -- this can re-render every
        // poll while a failure persists, and an assertive region would
        // interrupt screen reader users on that cadence. See
        // docs/design-system.md's live-region guidance. Badge matches the
        // app's one other error precedent (the login page) instead of
        // color-only text.
        <div role="status" className="pl-6">
          <Badge variant="error">
            Last advance attempt failed: {lastError} (still retrying every {POLL_DELAY_MS / 1000}s)
          </Badge>
        </div>
      )}
    </div>
  );
}

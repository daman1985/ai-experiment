"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceRunNowAction } from "@/app/runs/[id]/actions";

// Gap between one advance call finishing and the next one starting --
// paces off the actual turn latency (a self-scheduling loop) rather than
// firing on a fixed timer regardless of overlap, since a turn with a web
// search can take much longer than a plain one.
const POLL_DELAY_MS = 2000;

// Opt-in accelerant for when the admin is actually watching a run: while
// on, this pumps the run forward via the same advanceRun the cron tick
// uses, roughly every couple of seconds instead of every 10 minutes.
// There is no server-side "live mode" to turn back off -- leaving the
// page (unmount) or flipping the checkbox both just stop this component's
// own loop, and the run falls straight back to whatever the cron
// schedule already provides, which never stopped running underneath it.
export function LiveWatchToggle({ runId }: { runId: string }) {
  const [watching, setWatching] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        try {
          await advanceRunNowAction(runId);
        } catch {
          // A transient provider/network error shouldn't silently kill
          // live mode -- just keep pacing and let the next call retry.
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
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <input
        type="checkbox"
        checked={watching}
        onChange={(e) => setWatching(e.target.checked)}
        className="accent-accent"
      />
      Watch live
      <span className="text-text-tertiary">
        (advances every couple seconds while this is open -- real spend, same as any turn)
      </span>
    </label>
  );
}

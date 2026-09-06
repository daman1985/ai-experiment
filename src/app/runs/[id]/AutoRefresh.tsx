"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls the server component for fresh data while a run is active, so
// watching the log doesn't require manually reloading. 20s is frequent
// enough to feel live without hammering the DB between cron ticks (which
// themselves run far less often than this).
export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(interval);
  }, [enabled, router]);

  return null;
}

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

// How close to the bottom of the document counts as "following live" --
// see docs/design-system.md, "Live-feed behavior": never steal the
// viewport from someone scrolled up reading backlog.
const FOLLOWING_LIVE_THRESHOLD_PX = 120;

interface LiveTranscriptMeta {
  /** Stable id (Turn.id / Decision.id) used to diff what's new between polls. */
  id: string;
  /** Anchor element id to scroll to / focus for this item. */
  anchorId: string;
  /** Human-readable label used in the aria-live announcement. */
  label: string;
}

interface LiveTranscriptContextValue {
  initialLoadDoneRef: { current: boolean };
  followingLiveRef: { current: boolean };
}

const LiveTranscriptContext = createContext<LiveTranscriptContextValue | null>(null);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function scrollToBottom() {
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

/**
 * Wraps a newly-appeared feed item (turn row / decision break) with the
 * "new live event" entrance motion from docs/design-system.md's Motion
 * tokens table -- ~120ms, opacity + translateY(2px) -> 0 -- but only when
 * this item is genuinely new (mounted after the initial page load) AND
 * the viewer was following live at the moment it arrived. Existing items
 * on first render, and anything that arrives while the viewer is reading
 * backlog further up, render with no animation at all.
 *
 * This relies on React mount timing rather than timestamps: during the
 * very first render pass (initial load/hydration), no effect has run yet
 * so `initialLoadDoneRef.current` is still false for every item, however
 * deep in the tree. Only after that first commit does the ref flip to
 * true, permanently -- so any item whose component instance mounts after
 * that point is, by construction, one that arrived via a later refresh.
 */
export function NewItemFade({ children }: { children: ReactNode }) {
  const ctx = useContext(LiveTranscriptContext);
  const [shouldAnimate] = useState(
    () => !!ctx?.initialLoadDoneRef.current && !!ctx?.followingLiveRef.current,
  );

  if (!shouldAnimate) return <>{children}</>;
  // motion-safe: honors prefers-reduced-motion -- see docs/design-system.md
  // Motion tokens / "restricted to opacity/transform... honoring
  // prefers-reduced-motion".
  return <div className="motion-safe:animate-turn-enter">{children}</div>;
}

export function LiveTranscript({
  enabled,
  items,
  children,
}: {
  /** Poll for updates while the run is active. */
  enabled: boolean;
  /** Plain, serializable metadata for every item currently in the feed, in order. */
  items: LiveTranscriptMeta[];
  children: ReactNode;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const initialLoadDoneRef = useRef(false);
  const followingLiveRef = useRef(true);
  const prevIdsRef = useRef<Set<string>>(new Set(items.map((i) => i.id)));
  const [pendingCount, setPendingCount] = useState(0);
  const [announceText, setAnnounceText] = useState("");

  // Poll while active -- same 20s cadence as before, just relocated here
  // now that this component owns more than just the refresh timer. Paused
  // while the tab isn't visible: a forgotten background tab left open on
  // an active run otherwise polls forever, and enough of those piling up
  // across several runs is real pressure on the database's connection
  // pool -- observed directly causing the cron tick to time out.
  useEffect(() => {
    if (!enabled) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => router.refresh(), 20_000);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, router]);

  // Mark the initial load as complete once the first paint has committed,
  // so NewItemFade instances mounted before this point never animate.
  useEffect(() => {
    initialLoadDoneRef.current = true;
  }, []);

  // Track whether the viewer is "following live" (scrolled near the
  // bottom) vs. reading backlog further up.
  useEffect(() => {
    const computeFollowing = () => {
      const distanceFromBottom =
        document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      const nowFollowing = distanceFromBottom < FOLLOWING_LIVE_THRESHOLD_PX;
      if (nowFollowing && !followingLiveRef.current) {
        // Viewer scrolled back down to the bottom on their own -- the
        // pending pill has served its purpose.
        setPendingCount(0);
      }
      followingLiveRef.current = nowFollowing;
    };
    computeFollowing();
    window.addEventListener("scroll", computeFollowing, { passive: true });
    window.addEventListener("resize", computeFollowing);
    return () => {
      window.removeEventListener("scroll", computeFollowing);
      window.removeEventListener("resize", computeFollowing);
    };
  }, []);

  // Diff against the previous batch of items whenever new data arrives
  // (i.e. after a router.refresh() re-renders the parent Server
  // Component with fresh props). Only what's new gets announced -- never
  // re-announce the whole transcript.
  useEffect(() => {
    const prevIds = prevIdsRef.current;
    const newItems = items.filter((item) => !prevIds.has(item.id));
    if (newItems.length > 0) {
      if (followingLiveRef.current) {
        setAnnounceText(
          newItems.length === 1
            ? newItems[0].label
            : `${newItems.length} new updates in the transcript`,
        );
        // Following live: keep the viewport pinned to the bottom as new
        // content appears, rather than making the viewer scroll manually.
        requestAnimationFrame(scrollToBottom);
      } else {
        setPendingCount((count) => count + newItems.length);
        setAnnounceText(
          newItems.length === 1
            ? `${newItems[0].label} (scroll down to view)`
            : `${newItems.length} new updates waiting below`,
        );
      }
    }
    prevIdsRef.current = new Set(items.map((item) => item.id));
  }, [items]);

  // Roving tabindex (docs/design-system.md, "Long-transcript performance/
  // accessibility"): whichever feed item currently has focus becomes the
  // single tabIndex=0 stop, every other item becomes -1. Handles both
  // arrow-key movement and direct clicks landing on a row.
  function handleFocus(e: React.FocusEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[role="article"]');
    if (!target) return;
    const articles = e.currentTarget.querySelectorAll<HTMLElement>('[role="article"]');
    articles.forEach((el) => {
      el.tabIndex = el === target ? 0 : -1;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const current = (e.target as HTMLElement).closest<HTMLElement>('[role="article"]');
    if (!current) return;
    const articles = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="article"]'),
    );
    const index = articles.indexOf(current);
    if (index === -1) return;
    const nextIndex = e.key === "ArrowDown" ? index + 1 : index - 1;
    const next = articles[nextIndex];
    if (!next) return;
    e.preventDefault();
    next.focus();
  }

  function jumpToLive() {
    setPendingCount(0);
    followingLiveRef.current = true;
    scrollToBottom();
  }

  return (
    <LiveTranscriptContext.Provider value={{ initialLoadDoneRef, followingLiveRef }}>
      <div ref={rootRef} onFocus={handleFocus} onKeyDown={handleKeyDown}>
        {/* Dedicated off-screen live region -- see docs/design-system.md,
            "aria-live='polite' (never assertive) for feed updates, batched/
            throttled rather than announcing every token." Kept separate
            from the visible feed so re-renders of unrelated content never
            trigger spurious announcements. */}
        <div aria-live="polite" role="status" className="sr-only">
          {announceText}
        </div>
        {children}
        {pendingCount > 0 && (
          <div className="fixed inset-x-0 bottom-6 z-20 flex justify-center">
            <button
              type="button"
              onClick={jumpToLive}
              className="rounded-full border border-accent/30 bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm outline-none transition-colors duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {pendingCount} new &mdash; jump to live
            </button>
          </div>
        )}
      </div>
    </LiveTranscriptContext.Provider>
  );
}

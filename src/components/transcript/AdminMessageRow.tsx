import type { AdminMessage } from "@prisma/client";

// The human's own voice in the room -- visually distinct from an agent's
// TurnRow (accent-tinted instead of a per-provider color, no weakness
// critique or status badges, since none of that bookkeeping applies to
// something a person just said) but built on the same fixed-avatar-
// column layout so it reads as part of the same continuous transcript,
// not a different kind of surface.
export function AdminMessageRow({
  message,
  tabIndex,
  posinset,
  setsize,
}: {
  message: AdminMessage;
  tabIndex: number;
  posinset: number;
  setsize: number;
}) {
  return (
    <div
      id={`admin-message-${message.id}`}
      role="article"
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-label="You"
      tabIndex={tabIndex}
      className="border-b border-l-2 border-accent bg-accent/5 px-4 py-4 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <div className="grid grid-cols-[2rem_1fr] gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
          You
        </div>
        <div className="min-w-0">
          <span className="text-sm font-semibold text-accent">You</span>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
            {message.message}
          </p>
        </div>
      </div>
    </div>
  );
}

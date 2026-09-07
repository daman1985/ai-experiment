import { formatPhase } from "@/lib/format";
import type { Phase } from "@prisma/client";

export function PhaseDivider({ phase }: { phase: Phase }) {
  return (
    <div className="mb-4 mt-10 flex items-center gap-3 first:mt-0">
      <span className="whitespace-nowrap font-serif text-sm text-text-tertiary">
        {formatPhase(phase)}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

import type { Artifact } from "@prisma/client";
import { Badge } from "@/components/ui/Badge";

// Appears in the transcript at the moment an artifact is created (see
// docs/design-system.md, "Artifacts: both"). The separate Artifacts
// section at the bottom of the page is the other half of that decision.
export function ArtifactInlinePreview({ artifact }: { artifact: Artifact }) {
  const firstLine = artifact.content.split("\n").find((l) => l.trim().length > 0) ?? "";

  return (
    <details className="group mt-3 rounded-md border border-border bg-surface">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant="neutral">{artifact.type}</Badge>
            <span className="truncate font-medium text-text-primary">{artifact.title}</span>
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 text-xs text-text-tertiary transition-transform duration-150 group-open:rotate-180"
          >
            &#8964;
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-text-tertiary group-open:hidden">{firstLine}</p>
      </summary>
      <div className="border-t border-border px-3 py-2">
        <pre className="whitespace-pre-wrap font-sans text-sm text-text-secondary">
          {artifact.content}
        </pre>
      </div>
    </details>
  );
}

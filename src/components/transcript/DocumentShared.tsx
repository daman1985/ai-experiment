import type { Document } from "@prisma/client";
import { Badge } from "@/components/ui/Badge";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// A slim marker in the feed for admin-shared context -- deliberately
// lighter-weight than DecisionBreak's full-width block, since this isn't
// a moment the room itself produced, just a note that new input arrived
// and who was given access to it.
export function DocumentShared({
  document,
  agentNameById,
}: {
  document: Document;
  agentNameById: Map<string, string>;
}) {
  const accessIds = isStringArray(document.accessAgentIds) ? document.accessAgentIds : [];
  const sharedWithLabel = document.sharedWithAll
    ? "all agents"
    : accessIds.map((id) => agentNameById.get(id) ?? "Unknown").join(", ") || "no one";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-hover px-4 py-2 text-xs text-text-tertiary sm:px-6">
      <Badge variant="accent">{document.kind === "IMAGE" ? "Image shared" : "Document shared"}</Badge>
      <span className="font-medium text-text-secondary">{document.filename}</span>
      <span>with {sharedWithLabel}</span>
    </div>
  );
}

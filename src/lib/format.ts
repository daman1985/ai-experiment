import type { Phase, RunStatus } from "@prisma/client";

export function formatPhase(phase: Phase | string): string {
  switch (phase) {
    case "IDEATION":
      return "Ideation";
    case "ROLE_ASSIGNMENT":
      return "Role assignment";
    case "OPERATION":
      return "Operation";
    default:
      return phase;
  }
}

type BadgeVariant = "success" | "warning" | "error" | "neutral" | "accent";

export function runStatusVariant(status: RunStatus): BadgeVariant {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED") return "warning";
  if (status.startsWith("STOPPED")) return "error";
  if (status === "COMPLETED") return "accent";
  return "neutral";
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

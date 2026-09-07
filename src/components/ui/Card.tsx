import type { HTMLAttributes } from "react";

// Shared chrome only (border, radius, surface, padding) -- deliberately
// doesn't prescribe internal layout. Cards sharing a row read better
// with different internal anatomy, not identical ones. See
// docs/design-system.md.
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-border bg-surface p-4 ${className}`} {...props} />;
}

import type { ReactNode } from "react";

type Variant = "success" | "warning" | "error" | "neutral" | "accent";

// Status is always icon + muted background + text label together --
// never color alone. See docs/design-system.md. Text glyphs stand in
// for icons for now (no icon library in the project yet); swap for real
// SVG icons later without changing this component's API.
const VARIANT_STYLES: Record<Variant, string> = {
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  error: "bg-error-bg text-error-text",
  neutral: "bg-neutral-badge-bg text-neutral-badge-text",
  accent: "bg-accent/10 text-accent",
};

const VARIANT_GLYPH: Record<Variant, string> = {
  success: "●", // ●
  warning: "!",
  error: "×", // ×
  neutral: "·", // ·
  accent: "●",
};

interface BadgeProps {
  variant?: Variant;
  children: ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${VARIANT_STYLES[variant]}`}
    >
      <span aria-hidden="true">{VARIANT_GLYPH[variant]}</span>
      {children}
    </span>
  );
}

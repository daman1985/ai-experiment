import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

// One accent color, reserved for the single primary action in a given
// context -- don't reach for `primary` more than once per view. See
// docs/design-system.md.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover active:bg-accent-active",
  secondary: "bg-surface text-text-primary border border-border hover:bg-surface-hover",
  danger: "bg-surface text-error-text border border-error-text/30 hover:bg-error-bg",
  ghost: "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}

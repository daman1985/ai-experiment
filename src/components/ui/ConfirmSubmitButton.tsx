"use client";

import type { MouseEvent } from "react";
import { SubmitButton } from "./SubmitButton";

// A SubmitButton that guards against an accidental click on a
// destructive, irreversible action (e.g. wiping a whole log table) --
// native confirm() is enough here given the internal/admin-password
// context this is used in; no need for a custom modal.
export function ConfirmSubmitButton({
  confirmMessage,
  onClick,
  ...props
}: Parameters<typeof SubmitButton>[0] & { confirmMessage: string }) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(confirmMessage)) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }
  return <SubmitButton onClick={handleClick} {...props} />;
}

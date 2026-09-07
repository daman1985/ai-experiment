"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./Button";
import type { ComponentProps } from "react";

// A plain <Button type="submit"> inside a server-action <form> gives no
// visual feedback while the action is in flight -- for a fast action
// that's invisible, but for one that takes up to ~20s (like the
// diagnostic battery), it reads as "the button did nothing" even though
// the request went through and is just waiting on real network calls.
// useFormStatus needs a client component, hence this wrapper rather than
// inlining the pending check in the (server) page itself.
export function SubmitButton({
  children,
  pendingText,
  ...props
}: ComponentProps<typeof Button> & { pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

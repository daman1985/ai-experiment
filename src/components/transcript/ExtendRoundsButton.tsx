"use client";

import { Button } from "@/components/ui/Button";

// Temporary diagnostic wrapper: logs to the browser console the instant
// the button is clicked, before the native form submission fires the
// server action -- lets us confirm from devtools whether the click is
// even reaching the browser's submit handler, independent of whatever
// the server action itself does (see console.log calls in
// extendRoundsAction, visible in Vercel's runtime logs instead).
export function ExtendRoundsButton({ label }: { label: string }) {
  return (
    <Button
      type="submit"
      variant="secondary"
      className="px-2 py-1 text-xs"
      onClick={() => console.log("[ExtendRoundsButton] clicked, submitting form", { label })}
    >
      {label}
    </Button>
  );
}

import Link from "next/link";
import { logoutAction } from "../actions";
import { Button } from "@/components/ui/Button";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <nav className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <div className="flex items-center gap-5 text-sm">
          <Link href="/admin" className="text-text-secondary transition-colors hover:text-text-primary">
            Runs
          </Link>
          <Link
            href="/admin/settings"
            className="text-text-secondary transition-colors hover:text-text-primary"
          >
            Settings
          </Link>
          <Link href="/" className="text-text-tertiary transition-colors hover:text-text-primary">
            View public log
          </Link>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
            Sign out
          </Button>
        </form>
      </nav>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}

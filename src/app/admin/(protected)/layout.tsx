import Link from "next/link";
import { logoutAction } from "../actions";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex gap-4 text-sm">
          <Link href="/admin" className="hover:underline">
            Runs
          </Link>
          <Link href="/admin/settings" className="hover:underline">
            Settings
          </Link>
          <Link href="/" className="text-neutral-400 hover:underline">
            View public log
          </Link>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="text-sm text-neutral-400 hover:underline">
            Sign out
          </button>
        </form>
      </nav>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}

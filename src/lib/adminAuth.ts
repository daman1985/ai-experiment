import crypto from "crypto";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE } from "./adminSessionCookie";

export { ADMIN_SESSION_COOKIE };

// Deliberately two separate secrets: ADMIN_PASSWORD is what a human types
// in, ADMIN_SESSION_SECRET is a long random value that becomes the session
// cookie. Keeping them separate means the actual login password is never
// itself stored in a cookie. Login verification (Node runtime, via a
// Server Action) uses a timing-safe compare; middleware (Edge runtime)
// just compares the cookie to the session secret directly -- Edge doesn't
// have Node's crypto module, and there's no real timing-attack surface on
// an httpOnly cookie value for a single-operator admin tool.
export function verifyPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function createSession(): Promise<void> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET environment variable is not set.");
  }
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_SESSION_COOKIE);
}

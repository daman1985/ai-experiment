// Split from adminAuth.ts so the Edge middleware can import just the
// cookie name without pulling in Node's `crypto` module (which Edge
// runtime doesn't support) via the rest of that file.
export const ADMIN_SESSION_COOKIE = "admin_session";

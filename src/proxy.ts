import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/adminSessionCookie";

// Gates every /admin route (except the login page) and every /runs route
// behind the shared admin session. This is a single-operator hobby tool,
// not a multi-tenant system -- one shared password, one session cookie,
// no user accounts. "proxy" is the current Next.js name for what used to
// be "middleware.ts"; it always runs on the Node.js runtime.
export function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const expected = process.env.ADMIN_SESSION_SECRET;

  if (!expected || sessionCookie !== expected) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Reuses the admin session for the run viewer too, for now -- there's
  // only one operator looking at this. If this ever gets shared more
  // broadly, split this into a separate lighter-weight viewer password
  // that doesn't also grant access to Settings.
  //
  // "/admin" must be listed on its own -- "/admin/((?!login).*)" only
  // matches paths with something after the slash, so without this the
  // bare dashboard route at /admin would render completely ungated.
  matcher: ["/admin", "/admin/((?!login).*)", "/runs/:path*"],
};

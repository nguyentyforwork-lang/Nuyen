import { NextResponse, type NextRequest } from "next/server";
import { operatorFromRequest } from "@/lib/auth";

/**
 * Every page and API route requires an authenticated operator. Route handlers re-check
 * the operator themselves (see lib/http.ts). This proxy is the first gate, not the only one.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  let operator: string | null = null;
  try {
    operator = operatorFromRequest(request);
  } catch {
    // Misconfiguration: fail closed.
    operator = null;
  }
  if (operator) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { kind: "AUTH", message: "Not signed in" } }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

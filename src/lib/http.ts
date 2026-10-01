import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { TikTokMcpError, toErrorPayload } from "@/services/tiktok/errors";
import { operatorFromRequest } from "./auth";
import { ConfigError } from "./config";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind = "HTTP",
  ) {
    super(message);
  }
}

/** Re-checks authentication inside every handler (defense in depth beyond proxy.ts). */
export function requireOperator(req: NextRequest): string {
  const op = operatorFromRequest(req);
  if (!op) throw new HttpError(401, "Not signed in", "AUTH");
  return op;
}

/** CSRF guard for state-changing requests: same-origin fetches set this header. */
export function requireSameOriginWrite(req: NextRequest) {
  if (req.headers.get("x-tacc-request") !== "1") throw new HttpError(403, "Missing request header", "CSRF");
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) throw new HttpError(403, "Cross-origin request rejected", "CSRF");
}

export function handle<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: { kind: e.kind, message: e.message } }, { status: e.status });
      if (e instanceof ZodError) {
        return NextResponse.json({ error: { kind: "VALIDATION", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, { status: 400 });
      }
      if (e instanceof RangeError) return NextResponse.json({ error: { kind: "VALIDATION", message: e.message } }, { status: 400 });
      if (e instanceof ConfigError) return NextResponse.json({ error: { kind: "CONFIG", message: e.message } }, { status: 503 });
      if (e instanceof TikTokMcpError) {
        const status = e.kind === "RATE_LIMIT" ? 429 : e.kind === "INVALID_REQUEST" ? 400 : e.kind === "AUTH" ? 502 : e.kind === "TOOL_UNAVAILABLE" ? 501 : 502;
        return NextResponse.json({ error: toErrorPayload(e) }, { status });
      }
      console.error(e);
      return NextResponse.json({ error: { kind: "INTERNAL", message: (e as Error)?.message ?? "Internal error" } }, { status: 500 });
    }
  };
}

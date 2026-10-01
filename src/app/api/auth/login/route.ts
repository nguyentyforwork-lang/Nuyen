import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCredentials, createSessionToken, SESSION_COOKIE, sessionTtlSeconds } from "@/lib/auth";
import { getAppConfig } from "@/lib/config";
import { handle, HttpError, requireSameOriginWrite } from "@/lib/http";

const body = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });

export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const cfg = getAppConfig();
  if (cfg.APP_AUTH_MODE !== "password") throw new HttpError(400, "Password login is disabled (APP_AUTH_MODE=proxy_header)");
  const { username, password } = body.parse(await req.json());
  if (!checkCredentials(username, password)) throw new HttpError(401, "Invalid username or password", "AUTH");
  const res = NextResponse.json({ ok: true, operator: username });
  res.cookies.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true,
    sameSite: "strict",
    secure: cfg.APP_SECURE_COOKIES || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionTtlSeconds,
  });
  return res;
});

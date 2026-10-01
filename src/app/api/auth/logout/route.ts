import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { handle, requireSameOriginWrite } from "@/lib/http";

export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
});

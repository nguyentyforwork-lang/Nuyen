import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, requireOperator, requireSameOriginWrite } from "@/lib/http";
import { getActionEngine } from "@/services/tiktok/actions";

export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const operator = requireOperator(req);
  const { pendingId } = z.object({ pendingId: z.string().uuid() }).parse(await req.json());
  return NextResponse.json({ cancelled: await getActionEngine().cancel(pendingId, operator) });
});

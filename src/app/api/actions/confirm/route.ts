import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, requireOperator, requireSameOriginWrite } from "@/lib/http";
import { getActionEngine } from "@/services/tiktok/actions";

const body = z.object({
  pendingId: z.string().uuid(),
  /** Must be true when the reviewed plan exceeds the single-change safety limit. */
  acknowledgeLimitOverride: z.boolean().optional(),
});

/**
 * Step 2: executes a reviewed plan after explicit confirmation. Single use. Every item is
 * re-read before the write, executed via MCP, verified by reading back, and logged.
 */
export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const operator = requireOperator(req);
  const b = body.parse(await req.json());
  const result = await getActionEngine().confirm({ operator, pendingId: b.pendingId, acknowledgeLimitOverride: b.acknowledgeLimitOverride });
  return NextResponse.json(result);
});

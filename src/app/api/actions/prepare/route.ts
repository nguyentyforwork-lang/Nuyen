import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, requireOperator, requireSameOriginWrite } from "@/lib/http";
import { tiktokId } from "@/lib/params";
import { getActionEngine } from "@/services/tiktok/actions";

const target = z.object({ bcId: tiktokId.nullable().optional(), advertiserId: tiktokId, campaignId: tiktokId });
const body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("budget"),
    direction: z.enum(["increase", "decrease"]),
    change: z.object({ type: z.enum(["percent", "absolute"]), value: z.number().positive().finite() }),
    targets: z.array(target).min(1).max(100),
    source: z.enum(["MANUAL", "RULE_SUGGESTION"]).default("MANUAL"),
    ruleId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    kind: z.literal("status"),
    action: z.enum(["TURN_ON", "TURN_OFF"]),
    targets: z.array(target).min(1).max(100),
    source: z.enum(["MANUAL", "RULE_SUGGESTION"]).default("MANUAL"),
    ruleId: z.string().uuid().nullable().optional(),
  }),
]);

/**
 * Step 1 of every write: reads live values from TikTok and returns a plan for review
 * (current vs proposed, impact, warnings, blockers). Never writes to TikTok.
 */
export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const operator = requireOperator(req);
  const b = body.parse(await req.json());
  const targets = b.targets.map((t) => ({ bcId: t.bcId ?? null, advertiserId: t.advertiserId, campaignId: t.campaignId }));
  const engine = getActionEngine();
  const result =
    b.kind === "budget"
      ? await engine.prepareBudget({ operator, targets, direction: b.direction, change: b.change, source: b.source, ruleId: b.ruleId ?? null })
      : await engine.prepareStatus({ operator, targets, action: b.action, source: b.source, ruleId: b.ruleId ?? null });
  return NextResponse.json(result);
});

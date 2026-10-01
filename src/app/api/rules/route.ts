import { NextResponse } from "next/server";
import { createRule, listRules } from "@/db/repo";
import { handle, requireOperator, requireSameOriginWrite } from "@/lib/http";
import { ruleInputSchema } from "@/services/rules/engine";

export const GET = handle(async (req) => {
  requireOperator(req);
  return NextResponse.json({ items: await listRules() });
});

export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const operator = requireOperator(req);
  const r = ruleInputSchema.parse(await req.json());
  const row = await createRule({
    name: r.name,
    enabled: r.enabled,
    conditions: r.conditions,
    action: r.action,
    actionValue: r.actionValue != null ? String(r.actionValue) : null,
    bcId: r.bcId ?? null,
    advertiserId: r.advertiserId ?? null,
    createdBy: operator,
  });
  return NextResponse.json({ item: row }, { status: 201 });
});

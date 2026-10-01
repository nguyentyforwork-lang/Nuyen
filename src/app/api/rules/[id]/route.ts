import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteRule, updateRule } from "@/db/repo";
import { handle, HttpError, requireOperator, requireSameOriginWrite } from "@/lib/http";

const patch = z.object({ enabled: z.boolean().optional(), name: z.string().trim().min(1).max(120).optional() });

export const PATCH = handle<RouteContext<"/api/rules/[id]">>(async (req, ctx) => {
  requireSameOriginWrite(req);
  requireOperator(req);
  const id = z.string().uuid().parse((await ctx.params).id);
  const row = await updateRule(id, patch.parse(await req.json()));
  if (!row) throw new HttpError(404, "Rule not found");
  return NextResponse.json({ item: row });
});

export const DELETE = handle<RouteContext<"/api/rules/[id]">>(async (req, ctx) => {
  requireSameOriginWrite(req);
  requireOperator(req);
  await deleteRule(z.string().uuid().parse((await ctx.params).id));
  return NextResponse.json({ ok: true });
});

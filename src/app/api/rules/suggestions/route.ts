import { NextResponse } from "next/server";
import { z } from "zod";
import { dismissSuggestion, listDismissals, listRules } from "@/db/repo";
import { handle, requireOperator, requireSameOriginWrite } from "@/lib/http";
import { parseDatasetParams, tiktokId } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { evaluateRules, type Rule } from "@/services/rules/engine";

/** Suggested actions only. Executing one goes through /api/actions/prepare + confirm. */
export const GET = handle(async (req) => {
  requireOperator(req);
  const p = parseDatasetParams(req);
  const [ds, ruleRows] = await Promise.all([
    loadDataset({ bcId: p.bcId, advertiserId: p.advertiserId, range: p.range, minCreativeSpend: p.minCreativeSpend, force: p.force }),
    listRules(),
  ]);
  const rules: Rule[] = ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    conditions: r.conditions as Rule["conditions"],
    action: r.action as Rule["action"],
    actionValue: r.actionValue != null ? Number(r.actionValue) : null,
    bcId: r.bcId,
    advertiserId: r.advertiserId,
  }));
  const rangeKey = `${p.range.start}:${p.range.end}`;
  const dismissed = new Set((await listDismissals(rangeKey)).map((d) => `${d.ruleId}:${d.campaignId}`));
  const { suggestions, unevaluable } = evaluateRules(rules, ds.rows);
  return NextResponse.json({
    range: p.range,
    rangeLabel: p.rangeLabel,
    rangeKey,
    suggestions: suggestions
      .filter((s) => !dismissed.has(`${s.ruleId}:${s.campaign.campaignId}`))
      .map((s) => ({ ...s, campaign: { ...s.campaign, creatives: [], geos: [] } })),
    unevaluableCount: unevaluable.length,
    unevaluableReasons: [...new Set(unevaluable.map((u) => u.reason))],
    enabledRules: rules.filter((r) => r.enabled).length,
    notices: ds.notices,
  });
});

const dismissBody = z.object({ ruleId: z.string().uuid(), advertiserId: tiktokId, campaignId: tiktokId, rangeKey: z.string().max(40) });

export const POST = handle(async (req) => {
  requireSameOriginWrite(req);
  const operator = requireOperator(req);
  const b = dismissBody.parse(await req.json());
  await dismissSuggestion({ ...b, dismissedBy: operator });
  return NextResponse.json({ ok: true });
});

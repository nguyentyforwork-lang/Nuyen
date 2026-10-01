import { z } from "zod";
import type { CampaignRow } from "@/types";

/**
 * Rule engine. RECOMMENDATION ONLY: it turns conditions into suggested actions. It has no
 * access to TikTok write tools; a suggestion is executed only through the normal
 * prepare → review → confirm flow.
 */

export const RULE_METRICS = {
  iaa_d0_roas: { label: "IAA D0 ROAS", unit: "%" },
  spend: { label: "Spend", unit: "money" },
  budget: { label: "Budget", unit: "money" },
  conversions: { label: "Conversions", unit: "count" },
  cost_per_conversion: { label: "Cost per conversion", unit: "money" },
  installs: { label: "Installs", unit: "count" },
  cpi: { label: "CPI", unit: "money" },
  ctr: { label: "CTR", unit: "%" },
  impressions: { label: "Impressions", unit: "count" },
} as const;
export type RuleMetric = keyof typeof RULE_METRICS;

export const OPERATORS = ["<", "<=", ">", ">=", "="] as const;
export const RULE_ACTIONS = ["DECREASE_BUDGET", "INCREASE_BUDGET", "TURN_OFF", "TURN_ON"] as const;

export const conditionSchema = z.object({
  metric: z.enum(Object.keys(RULE_METRICS) as [RuleMetric, ...RuleMetric[]]),
  operator: z.enum(OPERATORS),
  value: z.number().finite(),
});

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    conditions: z.array(conditionSchema).min(1).max(6),
    action: z.enum(RULE_ACTIONS),
    actionValue: z.number().positive().max(100).nullable().optional(),
    bcId: z.string().nullable().optional(),
    advertiserId: z.string().nullable().optional(),
  })
  .refine((r) => !r.action.endsWith("_BUDGET") || (r.actionValue ?? 0) > 0, {
    message: "Budget actions need a percentage value",
    path: ["actionValue"],
  });

export type RuleCondition = z.infer<typeof conditionSchema>;
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  action: (typeof RULE_ACTIONS)[number];
  actionValue: number | null;
  bcId: string | null;
  advertiserId: string | null;
}

export function metricValue(r: CampaignRow, m: RuleMetric): number | null {
  switch (m) {
    case "iaa_d0_roas":
      return r.iaa.roasPct.ok ? r.iaa.roasPct.value : null;
    case "spend":
      return r.metrics.spend;
    case "budget":
      return r.budget.amount;
    case "conversions":
      return r.metrics.conversions;
    case "cost_per_conversion":
      return r.metrics.conversions > 0 ? r.metrics.costPerConversion : null;
    case "installs":
      return r.metrics.installs;
    case "cpi":
      return r.metrics.installs > 0 ? r.metrics.cpi : null;
    case "ctr":
      return r.metrics.impressions > 0 ? r.metrics.ctr : null;
    case "impressions":
      return r.metrics.impressions;
  }
}

const compare = (a: number, op: RuleCondition["operator"], b: number) =>
  op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : op === ">=" ? a >= b : Math.abs(a - b) < 1e-9;

export interface Suggestion {
  ruleId: string;
  ruleName: string;
  campaign: CampaignRow;
  action: Rule["action"];
  actionValue: number | null;
  matched: Array<{ metric: RuleMetric; operator: string; threshold: number; actual: number }>;
  proposedBudget: number | null;
}

export interface Unevaluable {
  ruleId: string;
  campaignId: string;
  reason: string;
}

/** Evaluates enabled rules against campaign rows. Missing metrics never match. */
export function evaluateRules(rules: Rule[], rows: CampaignRow[]) {
  const suggestions: Suggestion[] = [];
  const unevaluable: Unevaluable[] = [];
  for (const rule of rules.filter((r) => r.enabled)) {
    for (const row of rows) {
      if (rule.bcId && rule.bcId !== row.bcId) continue;
      if (rule.advertiserId && rule.advertiserId !== row.advertiserId) continue;
      if (row.statusBucket === "DELETED") continue;
      // Only suggest what is actually possible for this campaign.
      if (rule.action === "TURN_OFF" && row.operationStatus !== "ENABLE") continue;
      if (rule.action === "TURN_ON" && row.operationStatus !== "DISABLE") continue;
      if (rule.action.endsWith("_BUDGET") && !row.writeSupport.budget.ok) continue;
      if (!rule.action.endsWith("_BUDGET") && !row.writeSupport.status.ok) continue;

      const matched: Suggestion["matched"] = [];
      let all = true;
      for (const c of rule.conditions) {
        const actual = metricValue(row, c.metric);
        if (actual === null) {
          unevaluable.push({ ruleId: rule.id, campaignId: row.campaignId, reason: `${RULE_METRICS[c.metric].label} unavailable` });
          all = false;
          break;
        }
        if (!compare(actual, c.operator, c.value)) {
          all = false;
          break;
        }
        matched.push({ metric: c.metric, operator: c.operator, threshold: c.value, actual });
      }
      if (!all) continue;
      const pct = rule.actionValue ?? 0;
      const current = row.budget.amount;
      const proposedBudget =
        current != null && rule.action === "DECREASE_BUDGET"
          ? Math.round(current * (1 - pct / 100) * 100) / 100
          : current != null && rule.action === "INCREASE_BUDGET"
            ? Math.round(current * (1 + pct / 100) * 100) / 100
            : null;
      suggestions.push({ ruleId: rule.id, ruleName: rule.name, campaign: row, action: rule.action, actionValue: rule.actionValue, matched, proposedBudget });
    }
  }
  return { suggestions, unevaluable };
}

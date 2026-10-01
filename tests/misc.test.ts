import { describe, expect, it } from "vitest";
import { TtlCache } from "@/lib/cache";
import { inBudgetLockWindow, rangeLabel, resolveDateRange } from "@/lib/dates";
import { evaluateBudgetChange, proposedBudget } from "@/services/tiktok/actions/safety";
import { evaluateRules, ruleInputSchema, type Rule } from "@/services/rules/engine";
import { sanitize, toCsv } from "@/services/export";
import { parseToolResult } from "@/services/tiktok/mcp-client";
import { evaluateCapabilities } from "@/services/tiktok/tool-registry";
import { buildCampaignRows } from "@/services/dashboard/assemble";
import { IAA_UNAVAILABLE } from "@/services/tiktok/reporting/aggregate";

describe("date ranges", () => {
  const now = new Date("2026-10-01T03:00:00Z"); // 10:00 in Ho Chi Minh
  it("yesterday is the default-style single day", () => {
    expect(resolveDateRange("yesterday", "Asia/Ho_Chi_Minh", undefined, now)).toMatchObject({ start: "2026-09-30", end: "2026-09-30" });
  });
  it("last 7 = 7 complete days ending yesterday", () => {
    expect(resolveDateRange("last_7", "Asia/Ho_Chi_Minh", undefined, now)).toMatchObject({ start: "2026-09-24", end: "2026-09-30" });
  });
  it("respects time zone boundaries", () => {
    expect(resolveDateRange("today", "America/New_York", undefined, now).start).toBe("2026-09-30");
  });
  it("validates custom ranges", () => {
    expect(() => resolveDateRange("custom", "UTC", { start: "2026-09-10", end: "2026-09-01" }, now)).toThrow();
    expect(resolveDateRange("custom", "UTC", { start: "2026-09-01", end: "2026-09-10" }, now).end).toBe("2026-09-10");
  });
  it("labels metrics with the range", () => {
    expect(rangeLabel({ start: "2026-09-30", end: "2026-09-30" })).toBe("Sep 30, 2026");
    expect(rangeLabel({ start: "2026-09-24", end: "2026-09-30" })).toBe("Sep 24 – Sep 30, 2026");
  });
  it("budget lock window is 23:55–00:00 account time", () => {
    expect(inBudgetLockWindow("UTC", new Date("2026-10-01T23:56:00Z"))).toBe(true);
    expect(inBudgetLockWindow("UTC", new Date("2026-10-01T23:54:00Z"))).toBe(false);
  });
});

describe("budget safety", () => {
  const limits = { maxIncreasePct: 50, maxDecreasePct: 50 };
  it("computes percent and absolute proposals", () => {
    expect(proposedBudget(500, "increase", { type: "percent", value: 30 })).toBe(650);
    expect(proposedBudget(1000, "decrease", { type: "percent", value: 20 })).toBe(800);
    expect(proposedBudget(500, "increase", { type: "absolute", value: 650 })).toBe(650);
  });
  it("flags limit breaches and direction mistakes", () => {
    expect(evaluateBudgetChange({ current: 500, proposed: 800, direction: "increase", limits, todaySpend: 0, inLockWindow: false }).exceedsLimit).toBe(true);
    expect(evaluateBudgetChange({ current: 500, proposed: 400, direction: "increase", limits, todaySpend: 0, inLockWindow: false }).blockers.length).toBeGreaterThan(0);
  });
});

describe("rules (recommendation only)", () => {
  const ds = buildCampaignRows(
    {
      bcId: "1",
      account: { bcId: "1", advertiserId: "2", name: "acc", currency: "USD", timezone: "UTC", status: "STATUS_ENABLE", role: "ADMIN" },
      campaigns: [{ campaign_id: "9", campaign_name: "FotoPro WW", operation_status: "ENABLE", secondary_status: "CAMPAIGN_STATUS_ENABLE", budget: 1000, budget_mode: "BUDGET_MODE_DAY", objective_type: "APP_PROMOTION", campaign_automation_type: "MANUAL" }],
      apps: [],
      adgroupApps: new Map(),
      campaignReport: [{ dimensions: { campaign_id: "9" }, metrics: { spend: "325", rev: "267.8" } }],
      geoReport: [],
      creativeReport: [],
      iaa: { kind: "revenue_metric", metric: "rev" },
      fetchedAt: Date.now(),
    },
    20,
  );
  const rule: Rule = {
    id: "r1",
    name: "Low ROAS",
    enabled: true,
    action: "DECREASE_BUDGET",
    actionValue: 20,
    bcId: null,
    advertiserId: null,
    conditions: [
      { metric: "iaa_d0_roas", operator: "<", value: 90 },
      { metric: "spend", operator: ">", value: 100 },
    ],
  };
  it("creates a suggestion with the proposed budget; does not execute", () => {
    const { suggestions } = evaluateRules([rule], ds);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].proposedBudget).toBe(800);
    expect(suggestions[0].matched[0].actual).toBeCloseTo(82.4);
  });
  it("disabled rules and unavailable metrics never match", () => {
    expect(evaluateRules([{ ...rule, enabled: false }], ds).suggestions).toHaveLength(0);
    const noIaa = ds.map((r) => ({ ...r, iaa: { roasPct: { ok: false as const, reason: IAA_UNAVAILABLE }, revenue: { ok: false as const, reason: "" }, source: "unavailable" as const } }));
    const res = evaluateRules([rule], noIaa);
    expect(res.suggestions).toHaveLength(0);
    expect(res.unevaluable).toHaveLength(1);
  });
  it("validates rule input", () => {
    expect(ruleInputSchema.safeParse({ name: "x", conditions: [], action: "TURN_OFF" }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ name: "x", conditions: [{ metric: "spend", operator: ">", value: 1 }], action: "DECREASE_BUDGET" }).success).toBe(false);
  });
});

describe("export", () => {
  it("neutralises spreadsheet formulas and escapes CSV", () => {
    expect(sanitize("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCsv({ title: "", columns: ["a"], rows: [['x,"y"']] })).toContain('"x,""y"""');
  });
});

describe("cache", () => {
  it("dedupes, expires, invalidates by tag and throttles forced refresh", async () => {
    let t = 0;
    const c = new TtlCache(1000, 500, () => t);
    let calls = 0;
    const load = async () => ++calls;
    await Promise.all([c.get("k", ["adv:1"], load), c.get("k", ["adv:1"], load)]);
    expect(calls).toBe(1);
    await c.get("k", ["adv:1"], load, { force: true });
    expect(calls).toBe(2);
    await c.get("k", ["adv:1"], load, { force: true }); // within minRefresh → served from cache
    expect(calls).toBe(2);
    c.invalidate("adv:1");
    await c.get("k", ["adv:1"], load);
    expect(calls).toBe(3);
    t = 5000;
    await c.get("k", ["adv:1"], load);
    expect(calls).toBe(4);
  });
});

describe("MCP result parsing", () => {
  it("unwraps the TikTok envelope", () => {
    const env = parseToolResult("bc_get", { content: [{ type: "text", text: '{"code":0,"message":"OK","data":{"list":[]}}' }] });
    expect(env.data).toEqual({ list: [] });
  });
  it("throws classified errors (rate limit, invalid metric)", () => {
    expect(() => parseToolResult("x", { content: [{ type: "text", text: '{"code":40100,"message":"Too many requests","data":{}}' }] })).toThrow(/40100/);
    try {
      parseToolResult("report_integrated_get", { content: [{ type: "text", text: '{"code":40002,"message":"Invalid metric fields","data":{}}' }] });
    } catch (e) {
      expect((e as { kind: string }).kind).toBe("INVALID_REQUEST");
    }
  });
  it("capabilities are unavailable when a tool is not discovered", () => {
    const caps = evaluateCapabilities(new Map([["bc_get", { name: "bc_get", inputSchema: { properties: { page: {}, page_size: {} } } }]]));
    expect(caps.find((c) => c.capability === "listBusinessCenters")?.available).toBe(true);
    expect(caps.find((c) => c.capability === "updateCampaignBudget")?.available).toBe(false);
  });
});

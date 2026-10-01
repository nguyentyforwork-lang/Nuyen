import { describe, expect, it } from "vitest";
import { buildAppRows, buildCampaignRows, describeBudget, type AccountData } from "@/services/dashboard/assemble";
import { computeKpis, filterRows, matchesSearch } from "@/services/dashboard/query";
import { IAA_UNAVAILABLE, iaaFromMetrics, topCreative, topGeo, type IaaMode } from "@/services/tiktok/reporting/aggregate";
import { statusBucket } from "@/services/tiktok/reporting/status";
import type { CreativeRow, GeoRow } from "@/types";

const UNAVAILABLE: IaaMode = { kind: "unavailable", reason: IAA_UNAVAILABLE };
const REVENUE: IaaMode = { kind: "revenue_metric", metric: "x_d0_rev" };
const unavailableIaa = iaaFromMetrics(UNAVAILABLE, undefined, 0);

const creative = (id: string, spend: number, roas: number | null): CreativeRow => ({
  adId: id,
  adName: `ad ${id}`,
  adgroupId: "1",
  campaignId: "c",
  spend,
  conversions: 0,
  installs: 0,
  impressions: 0,
  clicks: 0,
  iaa: roas === null ? unavailableIaa : { roasPct: { ok: true, value: roas }, revenue: { ok: true, value: (roas / 100) * spend }, source: "revenue_metric" },
});

describe("IAA D0 ROAS", () => {
  it("is N/A with the required message when the metric is unavailable", () => {
    const i = iaaFromMetrics(UNAVAILABLE, { spend: "100" }, 100);
    expect(i.roasPct).toEqual({ ok: false, reason: "N/A — metric unavailable from current TikTok MCP reporting" });
  });
  it("is computed as D0 IAA revenue / spend, as a percentage", () => {
    const i = iaaFromMetrics(REVENUE, { x_d0_rev: "103.5" }, 100);
    expect(i.roasPct.ok && i.roasPct.value).toBeCloseTo(103.5);
  });
  it("official ROAS metric in ratio scale converts to %", () => {
    const i = iaaFromMetrics({ kind: "official_roas_metric", metric: "r", scale: "ratio" }, { r: "1.142" }, 50);
    expect(i.roasPct.ok && i.roasPct.value).toBeCloseTo(114.2);
  });
  it("missing metric value for a row is not treated as zero", () => {
    expect(iaaFromMetrics(REVENUE, { spend: "1" }, 1).roasPct.ok).toBe(false);
  });
});

describe("top creative", () => {
  it("a $2 / 300% creative does not beat a $1,000 / 105% creative", () => {
    const t = topCreative([creative("small", 2, 300), creative("big", 1000, 105)], 20);
    expect(t.creative?.adId).toBe("big");
  });
  it("among qualifying creatives the highest ROAS wins", () => {
    const t = topCreative([creative("a", 1245, 108.4), creative("b", 2000, 95), creative("c", 10, 400)], 20);
    expect(t.creative?.adId).toBe("a");
  });
  it("falls back to highest spend when ROAS is unavailable", () => {
    const t = topCreative([creative("a", 50, null), creative("b", 70, null)], 20);
    expect(t.creative?.adId).toBe("b");
    expect(t.basis).toMatch(/unavailable/);
  });
  it("threshold is configurable and reports when nothing qualifies", () => {
    expect(topCreative([creative("a", 15, null)], 20).creative).toBeNull();
    expect(topCreative([creative("a", 15, null)], 10).creative?.adId).toBe("a");
  });
});

describe("top geo", () => {
  const g = (cc: string, spend: number, conv: number): GeoRow => ({ countryCode: cc, spend, conversions: conv, installs: 0, impressions: 0, iaa: unavailableIaa });
  it("defaults to highest spend", () => {
    expect(topGeo([g("BR", 300, 90), g("US", 1240, 10)])?.countryCode).toBe("US");
  });
  it("can sort by conversions", () => {
    expect(topGeo([g("BR", 300, 90), g("US", 1240, 10)], "conversions")?.countryCode).toBe("BR");
  });
  it("returns null with no spend", () => {
    expect(topGeo([g("US", 0, 0)])).toBeNull();
  });
});

describe("status", () => {
  it("preserves TikTok's status; never infers from spend", () => {
    expect(statusBucket("CAMPAIGN_STATUS_ENABLE")).toBe("ACTIVE");
    expect(statusBucket("CAMPAIGN_STATUS_DISABLE")).toBe("PAUSED");
    expect(statusBucket("CAMPAIGN_STATUS_DELETE")).toBe("DELETED");
    expect(statusBucket("CAMPAIGN_STATUS_BUDGET_EXCEED")).toBe("NOT_DELIVERING");
    expect(statusBucket("CAMPAIGN_STATUS_ADVERTISER_AUDIT")).toBe("PENDING");
    expect(statusBucket("SOMETHING_NEW")).toBe("OTHER");
  });
});

describe("budget", () => {
  it("BUDGET_MODE_INFINITE means budget lives on ad groups", () => {
    expect(describeBudget({ budget: 0, budget_mode: "BUDGET_MODE_INFINITE" })).toMatchObject({ campaignLevel: false, amount: null });
    expect(describeBudget({ budget: 20, budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET" })).toMatchObject({ campaignLevel: true, amount: 20 });
  });
});

/* Shapes below mirror real responses captured from TikTok MCP during discovery. */
const account: AccountData = {
  bcId: "7689303456577044481",
  account: { bcId: "7689303456577044481", advertiserId: "7392895945995911169", name: "Flower App", currency: "USD", timezone: "Asia/Ho_Chi_Minh", status: "STATUS_ENABLE", role: "ADMIN" },
  campaigns: [
    { campaign_id: "11", campaign_name: "Flower Forest - WW - S+", operation_status: "ENABLE", secondary_status: "CAMPAIGN_STATUS_ENABLE", budget: 500, budget_mode: "BUDGET_MODE_DAY", objective_type: "APP_PROMOTION", app_id: "7398664548137353234", campaign_automation_type: "MANUAL" },
    { campaign_id: "12", campaign_name: "Flower Forest - US", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE", budget: 0, budget_mode: "BUDGET_MODE_INFINITE", objective_type: "APP_PROMOTION", app_id: "7398664548137353234", campaign_automation_type: "MANUAL" },
    { campaign_id: "13", campaign_name: "No app id at campaign", operation_status: "ENABLE", secondary_status: "CAMPAIGN_STATUS_ENABLE", budget: 100, budget_mode: "BUDGET_MODE_DAY", objective_type: "APP_PROMOTION", app_id: null, campaign_automation_type: "MANUAL" },
    { campaign_id: "14", campaign_name: "Web", operation_status: "ENABLE", secondary_status: "CAMPAIGN_STATUS_ENABLE", budget: 20, budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET", objective_type: "WEB_CONVERSIONS", campaign_automation_type: "UPGRADED_SMART_PLUS" },
  ],
  apps: [{ app_id: "7398664548137353234", app_name: "Flower Language: DIY Wallpaper" }, { app_id: "999", app_name: "FotoPro" }],
  adgroupApps: new Map([["13", "999"]]),
  campaignReport: [
    { dimensions: { campaign_id: "11", stat_time_day: "2026-09-29 00:00:00" }, metrics: { spend: "10.00", impressions: "1000", clicks: "10", conversion: "5", app_install: "4" } },
    { dimensions: { campaign_id: "11", stat_time_day: "2026-09-30 00:00:00" }, metrics: { spend: "30.00", impressions: "3000", clicks: "30", conversion: "5", app_install: "6" } },
  ],
  geoReport: [
    { dimensions: { campaign_id: "11", country_code: "PH" }, metrics: { spend: "4.44", conversion: "60" } },
    { dimensions: { campaign_id: "11", country_code: "US" }, metrics: { spend: "35.56", conversion: "18" } },
  ],
  creativeReport: [
    { dimensions: { ad_id: "a1" }, metrics: { campaign_id: "11", ad_name: "UGC_FlowerForest_80s_v03", spend: "30", adgroup_id: "g" } },
    { dimensions: { ad_id: "a2" }, metrics: { campaign_id: "11", ad_name: "", spend: "10", adgroup_id: "g" } },
  ],
  iaa: UNAVAILABLE,
  fetchedAt: Date.parse("2026-10-01T03:35:21Z"),
};

describe("campaign + app assembly", () => {
  const rows = buildCampaignRows(account, 20);
  it("sums daily rows and recomputes ratios from totals", () => {
    const r = rows.find((x) => x.campaignId === "11")!;
    expect(r.metrics.spend).toBe(40);
    expect(r.metrics.ctr).toBeCloseTo(1);
    expect(r.metrics.cpi).toBeCloseTo(4);
    expect(r.lastActive).toBe("2026-09-30");
    expect(r.topGeo?.countryCode).toBe("US");
    expect(r.topCreative.creative?.adName).toBe("UGC_FlowerForest_80s_v03");
    expect(r.iaa.roasPct.ok).toBe(false);
  });
  it("derives app from campaign, then from ad group, else none", () => {
    expect(rows.find((x) => x.campaignId === "11")).toMatchObject({ appName: "Flower Language: DIY Wallpaper", appSource: "campaign" });
    expect(rows.find((x) => x.campaignId === "13")).toMatchObject({ appId: "999", appName: "FotoPro", appSource: "adgroup" });
    expect(rows.find((x) => x.campaignId === "14")).toMatchObject({ appId: null, appSource: "none" });
  });
  it("write support reflects TikTok constraints", () => {
    expect(rows.find((x) => x.campaignId === "12")!.writeSupport.budget.ok).toBe(false);
    expect(rows.find((x) => x.campaignId === "14")!.writeSupport.budget.ok).toBe(true);
  });
  it("an app is running only if a campaign has TikTok status ENABLE", () => {
    const apps = buildAppRows(rows, 20);
    const flower = apps.find((a) => a.appId === "7398664548137353234")!;
    expect(flower).toMatchObject({ running: true, activeCampaigns: 1, totalCampaigns: 2, spend: 40 });
  });
  it("search covers names, IDs and creatives", () => {
    const r = rows.find((x) => x.campaignId === "11")!;
    for (const q of ["flower forest", "7392895945995911169", "7689303456577044481", "UGC_Flower", "a1", "diy wallpaper"]) expect(matchesSearch(r, q)).toBe(true);
    expect(matchesSearch(r, "zzz")).toBe(false);
  });
  it("filters by status (default Active) and running-apps toggle", () => {
    expect(filterRows(rows, { status: "ACTIVE" }).map((r) => r.campaignId)).toEqual(["11", "13", "14"]);
    expect(filterRows(rows, { status: "ALL", runningAppsOnly: true }).map((r) => r.campaignId)).toEqual(["11", "12", "13"]);
  });
  it("KPIs keep currencies separate and do not invent ROAS", () => {
    const k = computeKpis(rows, [account.account], buildAppRows(rows, 20));
    expect(k.totalSpend).toEqual({ USD: 40 });
    expect(k.avgIaaRoas.ok).toBe(false);
    expect(k.activeCampaigns).toBe(3);
  });
});

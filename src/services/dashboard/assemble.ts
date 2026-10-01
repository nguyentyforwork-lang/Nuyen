import type { AdAccount, AppRow, CampaignBudget, CampaignMetrics, CampaignRow, CreativeRow, GeoRow, Iaa, Maybe } from "@/types";
import { combineIaa, emptyMetrics, iaaFromMetrics, num, topCreative, topGeo, type IaaMode } from "../tiktok/reporting/aggregate";
import type { RawApp, RawCampaign, ReportRow } from "../tiktok/reporting/service";
import { statusBucket } from "../tiktok/reporting/status";

export function describeBudget(c: Pick<RawCampaign, "budget" | "budget_mode">): CampaignBudget {
  const amount = Number(c.budget) || 0;
  switch (c.budget_mode) {
    case "BUDGET_MODE_DAY":
      return { amount, mode: c.budget_mode, campaignLevel: amount > 0, label: "/day" };
    case "BUDGET_MODE_DYNAMIC_DAILY_BUDGET":
      return { amount, mode: c.budget_mode, campaignLevel: amount > 0, label: "/day (avg)" };
    case "BUDGET_MODE_TOTAL":
      return { amount, mode: c.budget_mode, campaignLevel: amount > 0, label: "lifetime" };
    case "BUDGET_MODE_INFINITE":
      return { amount: null, mode: c.budget_mode, campaignLevel: false, label: "Ad group budget" };
    default:
      return { amount: amount || null, mode: c.budget_mode ?? "UNKNOWN", campaignLevel: false, label: c.budget_mode ?? "Unknown" };
  }
}

const WRITABLE_AUTOMATION = new Set(["MANUAL", "UPGRADED_SMART_PLUS"]);

export function writeSupport(c: RawCampaign): CampaignRow["writeSupport"] {
  const automation = c.campaign_automation_type ?? "MANUAL";
  const deleted = c.secondary_status === "CAMPAIGN_STATUS_DELETE";
  const automationOk: Maybe<true> = WRITABLE_AUTOMATION.has(automation)
    ? { ok: true, value: true }
    : { ok: false, reason: `Write actions not supported for ${automation} campaigns via the current MCP tools` };
  return {
    budget: deleted
      ? { ok: false, reason: "Campaign is deleted" }
      : !automationOk.ok
        ? automationOk
        : describeBudget(c).campaignLevel
          ? { ok: true, value: true }
          : { ok: false, reason: "Budget is set at ad group level (campaign has no campaign-level budget)" },
    status: deleted ? { ok: false, reason: "Campaign is deleted" } : automationOk,
  };
}

/**
 * Sums report rows (possibly one per day) into one entry per campaign. Ratio metrics are
 * recomputed from the summed totals and are never averaged.
 */
export function aggregateCampaignReport(rows: ReportRow[], iaa: IaaMode) {
  interface Acc {
    m: CampaignMetrics;
    iaaRevenue: number;
    iaaMissing: boolean;
    lastActive: string | null;
  }
  const by = new Map<string, Acc>();
  for (const r of rows) {
    const id = r.dimensions.campaign_id;
    const acc = by.get(id) ?? { m: emptyMetrics(), iaaRevenue: 0, iaaMissing: false, lastActive: null };
    const spend = num(r.metrics.spend);
    acc.m.spend += spend;
    acc.m.impressions += num(r.metrics.impressions);
    acc.m.clicks += num(r.metrics.clicks);
    acc.m.conversions += num(r.metrics.conversion);
    acc.m.installs += num(r.metrics.app_install);
    const dayIaa = iaaFromMetrics(iaa, r.metrics, spend);
    if (spend > 0) {
      if (dayIaa.revenue.ok) acc.iaaRevenue += dayIaa.revenue.value;
      else acc.iaaMissing = true;
      const day = r.dimensions.stat_time_day?.slice(0, 10);
      if (day && (!acc.lastActive || day > acc.lastActive)) acc.lastActive = day;
    }
    by.set(id, acc);
  }
  const out = new Map<string, { metrics: CampaignMetrics; iaa: Iaa; lastActive: string | null }>();
  for (const [id, a] of by) {
    const m = a.m;
    m.ctr = m.impressions ? (m.clicks / m.impressions) * 100 : 0;
    m.cpc = m.clicks ? m.spend / m.clicks : 0;
    m.cpm = m.impressions ? (m.spend / m.impressions) * 1000 : 0;
    m.costPerConversion = m.conversions ? m.spend / m.conversions : 0;
    m.cpi = m.installs ? m.spend / m.installs : 0;
    let campaignIaa: Iaa;
    if (iaa.kind === "unavailable") campaignIaa = iaaFromMetrics(iaa, undefined, 0);
    else if (a.iaaMissing) {
      const reason = `${iaa.metric} missing for some days in range`;
      campaignIaa = { roasPct: { ok: false, reason }, revenue: { ok: false, reason }, source: iaa.kind };
    } else {
      campaignIaa = {
        revenue: { ok: true, value: a.iaaRevenue },
        roasPct: m.spend > 0 ? { ok: true, value: (a.iaaRevenue / m.spend) * 100 } : { ok: false, reason: "No spend in range" },
        source: iaa.kind,
      };
    }
    out.set(id, { metrics: m, iaa: campaignIaa, lastActive: a.lastActive });
  }
  return out;
}

export function geoRowsFromReport(rows: ReportRow[], iaa: IaaMode): Map<string, GeoRow[]> {
  const by = new Map<string, GeoRow[]>();
  for (const r of rows) {
    const spend = num(r.metrics.spend);
    const list = by.get(r.dimensions.campaign_id) ?? [];
    list.push({
      countryCode: r.dimensions.country_code,
      spend,
      conversions: num(r.metrics.conversion),
      installs: num(r.metrics.app_install),
      impressions: num(r.metrics.impressions),
      iaa: iaaFromMetrics(iaa, r.metrics, spend),
    });
    by.set(r.dimensions.campaign_id, list);
  }
  for (const list of by.values()) list.sort((a, b) => b.spend - a.spend);
  return by;
}

export function creativeRowsFromReport(rows: ReportRow[], iaa: IaaMode): Map<string, CreativeRow[]> {
  const by = new Map<string, CreativeRow[]>();
  for (const r of rows) {
    const campaignId = r.metrics.campaign_id;
    if (!campaignId) continue;
    const spend = num(r.metrics.spend);
    const list = by.get(campaignId) ?? [];
    list.push({
      adId: r.dimensions.ad_id,
      adName: r.metrics.ad_name || null,
      adgroupId: r.metrics.adgroup_id || null,
      campaignId,
      spend,
      conversions: num(r.metrics.conversion),
      installs: num(r.metrics.app_install),
      impressions: num(r.metrics.impressions),
      clicks: num(r.metrics.clicks),
      iaa: iaaFromMetrics(iaa, r.metrics, spend),
    });
    by.set(campaignId, list);
  }
  for (const list of by.values()) list.sort((a, b) => b.spend - a.spend);
  return by;
}

export interface AccountData {
  bcId: string;
  account: AdAccount;
  campaigns: RawCampaign[];
  apps: RawApp[];
  adgroupApps: Map<string, string>;
  /** null = not fetched because TikTok reported zero spend for the account in range. */
  campaignReport: ReportRow[] | null;
  geoReport: ReportRow[] | null;
  creativeReport: ReportRow[] | null;
  iaa: IaaMode;
  fetchedAt: number;
}

export function buildCampaignRows(d: AccountData, minCreativeSpend: number): CampaignRow[] {
  const perf = aggregateCampaignReport(d.campaignReport ?? [], d.iaa);
  const geos = geoRowsFromReport(d.geoReport ?? [], d.iaa);
  const ads = creativeRowsFromReport(d.creativeReport ?? [], d.iaa);
  const appNames = new Map(d.apps.map((a) => [a.app_id, a.app_name]));
  const lastUpdated = new Date(d.fetchedAt).toISOString();

  return d.campaigns.map<CampaignRow>((c) => {
    const p = perf.get(c.campaign_id);
    const campaignAppId = c.app_id && c.app_id !== "0" ? c.app_id : null;
    const adgroupAppId = campaignAppId ? null : (d.adgroupApps.get(c.campaign_id) ?? null);
    const appId = campaignAppId ?? adgroupAppId;
    const campaignGeos = geos.get(c.campaign_id) ?? [];
    const creatives = ads.get(c.campaign_id) ?? [];
    return {
      bcId: d.bcId,
      advertiserId: d.account.advertiserId,
      advertiserName: d.account.name,
      currency: d.account.currency,
      timezone: d.account.timezone,
      appId,
      appName: appId ? (appNames.get(appId) ?? null) : null,
      appSource: campaignAppId ? "campaign" : adgroupAppId ? "adgroup" : "none",
      campaignId: c.campaign_id,
      campaignName: c.campaign_name,
      objectiveType: c.objective_type,
      automationType: c.campaign_automation_type ?? "MANUAL",
      operationStatus: c.operation_status,
      secondaryStatus: c.secondary_status,
      statusBucket: statusBucket(c.secondary_status, c.operation_status),
      budget: describeBudget(c),
      metrics: p?.metrics ?? emptyMetrics(),
      iaa:
        p?.iaa ??
        (d.iaa.kind === "unavailable"
          ? iaaFromMetrics(d.iaa, undefined, 0)
          : { roasPct: { ok: false, reason: "No spend in range" }, revenue: { ok: false, reason: "No spend in range" }, source: d.iaa.kind }),
      topGeo: topGeo(campaignGeos),
      geos: campaignGeos,
      topCreative: topCreative(creatives, minCreativeSpend),
      creatives,
      lastActive: p?.lastActive ?? null,
      writeSupport: writeSupport(c),
      lastUpdated,
    };
  });
}

/**
 * Apps are derived from campaigns: campaign.app_id (APP_PROMOTION campaigns), falling back
 * to the ad groups' app_id. Names come from app_list_get. An app is "running" when at least
 * one of its campaigns has TikTok status CAMPAIGN_STATUS_ENABLE, which is never decided from spend.
 */
export function buildAppRows(rows: CampaignRow[], minCreativeSpend: number): AppRow[] {
  const groups = new Map<string, CampaignRow[]>();
  for (const r of rows) {
    if (!r.appId) continue;
    const key = `${r.advertiserId}:${r.appId}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    const geo = new Map<string, GeoRow>();
    for (const g of list.flatMap((r) => r.geos)) {
      const prev = geo.get(g.countryCode);
      if (!prev) {
        geo.set(g.countryCode, { ...g });
        continue;
      }
      const spend = prev.spend + g.spend;
      geo.set(g.countryCode, {
        ...prev,
        spend,
        conversions: prev.conversions + g.conversions,
        installs: prev.installs + g.installs,
        impressions: prev.impressions + g.impressions,
        iaa: combineIaa([{ iaa: prev.iaa, spend: prev.spend }, { iaa: g.iaa, spend: g.spend }], prev.iaa.roasPct.ok ? "" : prev.iaa.roasPct.reason),
      });
    }
    const active = list.filter((r) => r.statusBucket === "ACTIVE");
    const lastActive = list.map((r) => r.lastActive).filter((d): d is string => !!d).sort().at(-1) ?? null;
    return {
      bcId: first.bcId,
      advertiserId: first.advertiserId,
      advertiserName: first.advertiserName,
      currency: first.currency,
      appId: first.appId,
      appName: first.appName ?? `App ${first.appId}`,
      activeCampaigns: active.length,
      totalCampaigns: list.length,
      spend: list.reduce((s, r) => s + r.metrics.spend, 0),
      iaa: combineIaa(list.map((r) => ({ iaa: r.iaa, spend: r.metrics.spend })), first.iaa.roasPct.ok ? "" : first.iaa.roasPct.reason),
      topGeo: topGeo([...geo.values()]),
      topCreative: topCreative(list.flatMap((r) => r.creatives), minCreativeSpend),
      lastActive,
      running: active.length > 0,
      statusBuckets: [...new Set(list.map((r) => r.statusBucket))],
    };
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { addDays, daysBetween } from "@/lib/dates";
import { handle, HttpError, requireOperator } from "@/lib/http";
import { parseDatasetParams } from "@/lib/params";
import { iaaFromMetrics, num } from "@/services/tiktok/reporting/aggregate";
import { BASE_METRICS, forEachAccount, getTikTokService, iaaMetrics } from "@/services/tiktok/reporting/service";

const extra = z.object({
  level: z.enum(["campaign", "adgroup", "ad"]).default("campaign"),
  breakdown: z.enum(["none", "country", "day"]).default("none"),
  geo: z.string().regex(/^[A-Z]{2}(,[A-Z]{2})*$/).optional(),
  adIds: z.string().regex(/^\d+(,\d+)*$/).optional(),
});

const LEVEL = {
  campaign: { dataLevel: "AUCTION_CAMPAIGN", idDim: "campaign_id", attrs: ["campaign_name"] },
  adgroup: { dataLevel: "AUCTION_ADGROUP", idDim: "adgroup_id", attrs: ["adgroup_name", "campaign_id", "campaign_name"] },
  ad: { dataLevel: "AUCTION_AD", idDim: "ad_id", attrs: ["ad_name", "adgroup_id", "campaign_id", "campaign_name"] },
} as const;

/** Reporting page. Only metrics verified against TikTok MCP reporting are offered. */
export const GET = handle(async (req) => {
  requireOperator(req);
  const p = parseDatasetParams(req);
  const sp = req.nextUrl.searchParams;
  const x = extra.parse({ level: sp.get("level") ?? undefined, breakdown: sp.get("breakdown") ?? undefined, geo: sp.get("geo") || undefined, adIds: sp.get("adIds") || undefined });
  if (x.breakdown === "day" && daysBetween(p.range.start, p.range.end) > 29) throw new HttpError(400, "Daily breakdown is limited to 30 days by TikTok");

  const svc = getTikTokService();
  const lvl = LEVEL[x.level];
  let accounts = await svc.getAdAccounts(p.bcId, p.force);
  if (p.advertiserId) accounts = accounts.filter((a) => a.advertiserId === p.advertiserId);
  if (!accounts.length) throw new HttpError(404, "No ad accounts match the filter");
  if (accounts.length > 50 && !p.advertiserId) throw new HttpError(400, "Select an ad account. This BC has more than 50 accounts");

  const spendMap = await svc.getBcAccountSpend(p.bcId, { ...p.range, start: addDays(p.range.start, -1), end: addDays(p.range.end, 1) }, p.force);
  const iaa = await svc.resolveIaaMode(accounts[0].advertiserId);
  // A geo filter needs the country dimension; TikTok rejects country_code as a filter field,
  // so geo is filtered here after the AUDIENCE report returns.
  const byCountry = x.breakdown === "country" || !!x.geo;
  if (x.geo && x.breakdown === "day") throw new HttpError(400, "Geo filter cannot be combined with the daily breakdown");
  const useAudience = byCountry;
  const geoSet = x.geo ? new Set(x.geo.split(",")) : null;
  const dims = [lvl.idDim, ...(byCountry ? ["country_code"] : x.breakdown === "day" ? ["stat_time_day"] : [])];

  const results = await forEachAccount(accounts, async (a) => {
    if (spendMap && !(spendMap.get(a.advertiserId) ?? 0)) return [];
    // App / campaign filters resolve to TikTok's campaign_ids filter.
    let campaignIds = p.campaignIds;
    if (p.appId) {
      const { campaigns } = await svc.getCampaigns(a.advertiserId, p.force);
      const ids = campaigns.filter((c) => c.app_id === p.appId).map((c) => c.campaign_id);
      const adgroupApps = await svc.getAdgroupAppIds(a.advertiserId, campaigns.filter((c) => !c.app_id && c.objective_type === "APP_PROMOTION").map((c) => c.campaign_id), p.force);
      for (const [cid, app] of adgroupApps) if (app === p.appId) ids.push(cid);
      campaignIds = campaignIds ? campaignIds.filter((id) => ids.includes(id)) : ids;
      if (!campaignIds.length) return [];
    }
    const filtering: unknown[] = [];
    if (campaignIds?.length) filtering.push({ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(campaignIds.slice(0, 100)) });
    if (x.adIds) filtering.push({ field_name: "ad_ids", filter_type: "IN", filter_value: JSON.stringify(x.adIds.split(",").slice(0, 100)) });
    const { rows } = await svc.getCustomReport(
      a.advertiserId,
      {
        reportType: useAudience ? "AUDIENCE" : "BASIC",
        dataLevel: lvl.dataLevel,
        dimensions: dims,
        // Audience reports do not accept the attribute (name) metrics.
        metrics: [...BASE_METRICS, ...(useAudience ? [] : lvl.attrs), ...iaaMetrics(iaa)],
        range: p.range,
        filtering,
      },
      p.force,
    );
    return rows.filter((r) => !geoSet || geoSet.has(r.dimensions.country_code)).map((r) => {
      const spend = num(r.metrics.spend);
      const i = iaaFromMetrics(iaa, r.metrics, spend);
      return {
        bcId: p.bcId,
        advertiserId: a.advertiserId,
        advertiserName: a.name,
        currency: a.currency,
        id: r.dimensions[lvl.idDim],
        name: r.metrics[lvl.attrs[0]] ?? null,
        campaignId: r.metrics.campaign_id ?? (x.level === "campaign" ? r.dimensions.campaign_id : null),
        campaignName: r.metrics.campaign_name ?? null,
        countryCode: r.dimensions.country_code ?? null,
        day: r.dimensions.stat_time_day?.slice(0, 10) ?? null,
        spend,
        impressions: num(r.metrics.impressions),
        clicks: num(r.metrics.clicks),
        ctr: num(r.metrics.ctr),
        cpi: num(r.metrics.cost_per_app_install),
        installs: num(r.metrics.app_install),
        conversions: num(r.metrics.conversion),
        costPerConversion: num(r.metrics.cost_per_conversion),
        iaaRevenue: i.revenue.ok ? i.revenue.value : null,
        iaaRoasPct: i.roasPct.ok ? i.roasPct.value : null,
      };
    });
  });

  const rows = results.flatMap((r) => (r.ok ? r.value : []));
  const errors = results.filter((r) => !r.ok).map((r) => ({ advertiserId: r.account.advertiserId, message: (r as { error: Error }).error.message }));
  rows.sort((a, b) => b.spend - a.spend);
  const page = Math.max(1, p.page);
  return NextResponse.json({
    range: p.range,
    rangeLabel: p.rangeLabel,
    iaa,
    metricsAvailable: {
      spend: true,
      impressions: true,
      clicks: true,
      ctr: true,
      cpi: true,
      conversions: true,
      iaaRevenue: iaa.kind === "revenue_metric",
      iaaRoas: iaa.kind !== "unavailable",
    },
    total: rows.length,
    page,
    pageSize: p.pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / p.pageSize)),
    items: rows.slice((page - 1) * p.pageSize, page * p.pageSize),
    errors,
  });
});

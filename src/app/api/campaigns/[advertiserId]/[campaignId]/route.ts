import { NextResponse } from "next/server";
import { listActionLogs } from "@/db/repo";
import { addDays, daysBetween } from "@/lib/dates";
import { handle, HttpError, requireOperator } from "@/lib/http";
import { parseDatasetParams, tiktokId } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { iaaFromMetrics, num } from "@/services/tiktok/reporting/aggregate";
import { getTikTokService } from "@/services/tiktok/reporting/service";

/** Detail drawer: row, daily Spend/ROAS series, geo + creative breakdowns, recent actions. */
export const GET = handle<RouteContext<"/api/campaigns/[advertiserId]/[campaignId]">>(async (req, ctx) => {
  requireOperator(req);
  const params = await ctx.params;
  const advertiserId = tiktokId.parse(params.advertiserId);
  const campaignId = tiktokId.parse(params.campaignId);
  req.nextUrl.searchParams.set("advertiserId", advertiserId);
  const p = parseDatasetParams(req);
  const ds = await loadDataset({ bcId: p.bcId, advertiserId, range: p.range, minCreativeSpend: p.minCreativeSpend, force: p.force });
  const row = ds.rows.find((r) => r.campaignId === campaignId);
  if (!row) throw new HttpError(404, "Campaign not found in this ad account");

  // Daily series: TikTok allows ≤30 days with stat_time_day; use the last 30 days of the range.
  const seriesRange = daysBetween(p.range.start, p.range.end) > 29 ? { ...p.range, start: addDays(p.range.end, -29) } : p.range;
  const daily = await getTikTokService().getCampaignReport(advertiserId, seriesRange, { daily: true, campaignIds: [campaignId], force: p.force });
  const series = daily.rows
    .map((r) => {
      const spend = num(r.metrics.spend);
      const iaa = iaaFromMetrics(daily.iaa, r.metrics, spend);
      return { day: r.dimensions.stat_time_day.slice(0, 10), spend, roasPct: iaa.roasPct.ok ? iaa.roasPct.value : null, conversions: num(r.metrics.conversion), installs: num(r.metrics.app_install) };
    })
    .sort((a, b) => a.day.localeCompare(b.day));

  let history: Awaited<ReturnType<typeof listActionLogs>>["items"] = [];
  let historyError: string | null = null;
  try {
    history = (await listActionLogs({ advertiserId, campaignId, limit: 20 })).items;
  } catch (e) {
    historyError = `Action history unavailable: ${(e as Error).message}`;
  }

  return NextResponse.json({
    range: p.range,
    rangeLabel: p.rangeLabel,
    seriesRange,
    row,
    series,
    history,
    historyError,
    notices: ds.notices,
    iaa: ds.iaa,
  });
});

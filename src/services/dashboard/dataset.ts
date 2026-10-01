import "server-only";
import { getAppConfig } from "@/lib/config";
import { addDays, daysBetween, includesToday } from "@/lib/dates";
import type { AdAccount, AppRow, CampaignRow, DataNotice, DateRange } from "@/types";
import { TikTokMcpError } from "../tiktok/errors";
import { IAA_UNAVAILABLE, type IaaMode } from "../tiktok/reporting/aggregate";
import { forEachAccount, getTikTokService } from "../tiktok/reporting/service";
import { buildAppRows, buildCampaignRows, type AccountData } from "./assemble";

export interface Dataset {
  bcId: string;
  range: DateRange;
  accounts: AdAccount[];
  rows: CampaignRow[];
  apps: AppRow[];
  notices: DataNotice[];
  iaa: IaaMode;
  lastUpdated: string;
  minCreativeSpend: number;
}

/**
 * Loads one Business Center (optionally narrowed to one ad account) for a date range.
 * Lazy by design: nothing is loaded until a BC is selected, and report calls are skipped for
 * accounts TikTok reports as having zero spend in range.
 */
export async function loadDataset(opts: {
  bcId: string;
  advertiserId?: string | null;
  range: DateRange;
  minCreativeSpend?: number;
  force?: boolean;
}): Promise<Dataset> {
  const svc = getTikTokService();
  const app = getAppConfig();
  const minCreativeSpend = opts.minCreativeSpend ?? app.APP_DEFAULT_MIN_CREATIVE_SPEND;
  const notices: DataNotice[] = [];

  let accounts = await svc.getAdAccounts(opts.bcId, opts.force);
  if (opts.advertiserId) {
    accounts = accounts.filter((a) => a.advertiserId === opts.advertiserId);
    if (!accounts.length) throw new TikTokMcpError("INVALID_REQUEST", `Ad account ${opts.advertiserId} is not in BC ${opts.bcId}`);
  }

  // Window widened by a day each side so account/BC time-zone differences never hide spend.
  const spendMap = await svc.getBcAccountSpend(
    opts.bcId,
    { ...opts.range, start: addDays(opts.range.start, -1), end: addDays(opts.range.end, 1) },
    opts.force,
  );
  if (!spendMap) notices.push({ level: "info", message: "BC spend pre-filter unavailable (BC report not permitted); reporting each account individually." });

  const daily = daysBetween(opts.range.start, opts.range.end) <= 29;
  const iaa = accounts.length ? await svc.resolveIaaMode(accounts[0].advertiserId) : ({ kind: "unavailable", reason: IAA_UNAVAILABLE } as IaaMode);

  const results = await forEachAccount(accounts, async (account): Promise<AccountData> => {
    const { campaigns, fetchedAt } = await svc.getCampaigns(account.advertiserId, opts.force);
    const hasSpend = spendMap ? (spendMap.get(account.advertiserId) ?? 0) > 0 : true;
    const appCampaigns = campaigns.filter((c) => c.objective_type === "APP_PROMOTION");
    const missingApp = appCampaigns.filter((c) => !c.app_id || c.app_id === "0").map((c) => c.campaign_id);
    const [apps, adgroupApps, rep, geo, ads] = await Promise.all([
      appCampaigns.length ? svc.getApps(account.advertiserId, opts.force) : Promise.resolve([]),
      svc.getAdgroupAppIds(account.advertiserId, missingApp, opts.force),
      hasSpend && campaigns.length ? svc.getCampaignReport(account.advertiserId, opts.range, { daily, force: opts.force }) : null,
      hasSpend && campaigns.length ? svc.getGeoReport(account.advertiserId, opts.range, { force: opts.force }) : null,
      hasSpend && campaigns.length ? svc.getCreativeReport(account.advertiserId, opts.range, { force: opts.force }) : null,
    ]);
    return {
      bcId: opts.bcId,
      account,
      campaigns,
      apps,
      adgroupApps,
      campaignReport: rep?.rows ?? null,
      geoReport: geo?.rows ?? null,
      creativeReport: ads?.rows ?? null,
      iaa,
      fetchedAt: rep?.fetchedAt ?? fetchedAt,
    };
  });

  const rows: CampaignRow[] = [];
  let oldest = Date.now();
  for (const r of results) {
    if (!r.ok) {
      notices.push({ level: "error", message: `Ad account ${r.account.name} (${r.account.advertiserId}) failed to load: ${(r.error as TikTokMcpError).userMessage ?? r.error.message}` });
      continue;
    }
    oldest = Math.min(oldest, r.value.fetchedAt);
    rows.push(...buildCampaignRows(r.value, minCreativeSpend));
  }

  if (iaa.kind === "unavailable") notices.push({ level: "warning", message: `IAA D0 ROAS: ${iaa.reason}` });
  if (includesToday(opts.range, app.APP_TIMEZONE)) notices.push({ level: "warning", message: "Data may be delayed by TikTok reporting." });
  if (!daily) notices.push({ level: "info", message: "Range > 30 days: 'Last active' day is not computed (TikTok daily breakdown limit)." });

  return {
    bcId: opts.bcId,
    range: opts.range,
    accounts,
    rows,
    apps: buildAppRows(rows, minCreativeSpend),
    notices,
    iaa,
    lastUpdated: new Date(oldest).toISOString(),
    minCreativeSpend,
  };
}

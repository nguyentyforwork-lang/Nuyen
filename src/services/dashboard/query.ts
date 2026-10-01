import type { AdAccount, AppRow, CampaignRow, DashboardKpis, MoneyByCurrency, StatusFilter } from "@/types";
import { addMoney, averageRoas, IAA_UNAVAILABLE } from "../tiktok/reporting/aggregate";

export interface RowFilters {
  advertiserId?: string | null;
  appId?: string | null;
  status?: StatusFilter;
  q?: string | null;
  runningAppsOnly?: boolean;
  campaignIds?: string[] | null;
}

/** Global search over BC ID, account ID, app, campaign and creative names/IDs. */
export function matchesSearch(r: CampaignRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    r.bcId,
    r.advertiserId,
    r.advertiserName,
    r.appId,
    r.appName,
    r.campaignName,
    r.campaignId,
    ...r.creatives.flatMap((c) => [c.adId, c.adName]),
  ];
  return hay.some((h) => h != null && String(h).toLowerCase().includes(needle));
}

export function filterRows(rows: CampaignRow[], f: RowFilters): CampaignRow[] {
  const runningApps = f.runningAppsOnly
    ? new Set(rows.filter((r) => r.appId && r.statusBucket === "ACTIVE").map((r) => `${r.advertiserId}:${r.appId}`))
    : null;
  const ids = f.campaignIds?.length ? new Set(f.campaignIds) : null;
  return rows.filter(
    (r) =>
      (!f.advertiserId || r.advertiserId === f.advertiserId) &&
      (!f.appId || r.appId === f.appId) &&
      (!f.status || f.status === "ALL" || r.statusBucket === f.status) &&
      (!runningApps || runningApps.has(`${r.advertiserId}:${r.appId}`)) &&
      (!ids || ids.has(r.campaignId)) &&
      (!f.q || matchesSearch(r, f.q)),
  );
}

export function computeKpis(rows: CampaignRow[], accounts: AdAccount[], apps: AppRow[]): DashboardKpis {
  const totalSpend: MoneyByCurrency = {};
  for (const r of rows) addMoney(totalSpend, r.currency, r.metrics.spend);
  const reason = rows[0]?.iaa.roasPct.ok === false ? rows[0].iaa.roasPct.reason : IAA_UNAVAILABLE;
  const shownAccounts = new Set(rows.map((r) => r.advertiserId));
  const shownApps = new Set(rows.map((r) => `${r.advertiserId}:${r.appId}`));
  return {
    totalSpend,
    avgIaaRoas: rows.length
      ? averageRoas(rows.map((r) => ({ iaa: r.iaa, spend: r.metrics.spend, currency: r.currency })), reason)
      : { ok: false, reason: "No campaigns in selection" },
    activeCampaigns: rows.filter((r) => r.statusBucket === "ACTIVE").length,
    activeApps: apps.filter((a) => a.running && shownApps.has(`${a.advertiserId}:${a.appId}`)).length,
    adAccounts: rows.length ? shownAccounts.size : accounts.length,
  };
}

export type SortKey =
  | "status"
  | "bcId"
  | "advertiserId"
  | "app"
  | "campaign"
  | "campaignId"
  | "budget"
  | "spend"
  | "roas"
  | "topGeo"
  | "topCreative";

export function sortRows(rows: CampaignRow[], key: SortKey = "spend", dir: "asc" | "desc" = "desc"): CampaignRow[] {
  const val = (r: CampaignRow): number | string => {
    switch (key) {
      case "status":
        return r.secondaryStatus;
      case "bcId":
        return r.bcId;
      case "advertiserId":
        return r.advertiserId;
      case "app":
        return r.appName ?? "";
      case "campaign":
        return r.campaignName.toLowerCase();
      case "campaignId":
        return r.campaignId;
      case "budget":
        return r.budget.amount ?? -1;
      case "spend":
        return r.metrics.spend;
      case "roas":
        return r.iaa.roasPct.ok ? r.iaa.roasPct.value : -1;
      case "topGeo":
        return r.topGeo?.spend ?? -1;
      case "topCreative":
        return r.topCreative.creative?.spend ?? -1;
    }
  };
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * mul;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { items: rows.slice((p - 1) * pageSize, p * pageSize), page: p, pageSize, total: rows.length, totalPages };
}

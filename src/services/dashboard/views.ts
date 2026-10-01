import type { AppRow, CampaignRow, Maybe, MoneyByCurrency, StatusFilter } from "@/types";
import { addMoney, combineIaa, IAA_UNAVAILABLE } from "../tiktok/reporting/aggregate";
import type { Dataset } from "./dataset";
import { computeKpis, filterRows, paginate, sortRows, type RowFilters, type SortKey } from "./query";

export function campaignsView(ds: Dataset, f: RowFilters & { sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number }) {
  const filtered = filterRows(ds.rows, f);
  const sorted = sortRows(filtered, (f.sort as SortKey) || "spend", f.dir ?? "desc");
  const appOptions = new Map<string, string>();
  for (const r of ds.rows) if (r.appId && (!f.advertiserId || r.advertiserId === f.advertiserId)) appOptions.set(r.appId, r.appName ?? `App ${r.appId}`);
  const page = paginate(sorted, f.page, f.pageSize);
  return {
    kpis: computeKpis(filtered, ds.accounts, ds.apps),
    ...page,
    // Full creative/geo lists stay server-side (used for search); the drawer loads its own.
    items: page.items.map((r) => ({ ...r, creatives: [], geos: [] })),
    appOptions: [...appOptions].map(([appId, name]) => ({ appId, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function appsView(ds: Dataset, f: { advertiserId?: string | null; status?: StatusFilter; runningAppsOnly?: boolean; q?: string | null; page: number; pageSize: number }) {
  const q = f.q?.trim().toLowerCase();
  const items = ds.apps
    .filter((a) => !f.advertiserId || a.advertiserId === f.advertiserId)
    // Status: ACTIVE = running (≥1 campaign ENABLE); other statuses = has a campaign in that status.
    .filter((a) => !f.runningAppsOnly || a.running)
    .filter((a) => !f.status || f.status === "ALL" || (f.status === "ACTIVE" ? a.running : a.statusBuckets.includes(f.status)))
    .filter((a) => !q || [a.appName, a.appId, a.advertiserId, a.bcId].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.running) - Number(a.running) || b.spend - a.spend);
  return paginate(items, f.page, f.pageSize);
}

export interface AccountSummary {
  bcId: string;
  advertiserId: string;
  name: string;
  currency: string | null;
  status: string | null;
  apps: number;
  runningApps: number;
  activeCampaigns: number;
  totalCampaigns: number;
  spend: number;
  iaaRoas: Maybe<number>;
}

export function accountSummaries(ds: Dataset): AccountSummary[] {
  return ds.accounts
    .map((a) => {
      const rows = ds.rows.filter((r) => r.advertiserId === a.advertiserId);
      const apps = ds.apps.filter((p) => p.advertiserId === a.advertiserId);
      const reason = rows[0] && !rows[0].iaa.roasPct.ok ? rows[0].iaa.roasPct.reason : IAA_UNAVAILABLE;
      return {
        bcId: a.bcId,
        advertiserId: a.advertiserId,
        name: a.name,
        currency: a.currency,
        status: a.status,
        apps: apps.length,
        runningApps: apps.filter((p) => p.running).length,
        activeCampaigns: rows.filter((r) => r.statusBucket === "ACTIVE").length,
        totalCampaigns: rows.length,
        spend: rows.reduce((s, r) => s + r.metrics.spend, 0),
        iaaRoas: rows.length ? combineIaa(rows.map((r) => ({ iaa: r.iaa, spend: r.metrics.spend })), reason).roasPct : { ok: false as const, reason: "No campaigns" },
      };
    })
    .sort((x, y) => y.activeCampaigns - x.activeCampaigns || y.spend - x.spend);
}

/** BC → accounts → apps → campaigns tree with BC-level totals. */
export function bcOverview(ds: Dataset) {
  const accounts = accountSummaries(ds);
  const spend: MoneyByCurrency = {};
  for (const r of ds.rows) addMoney(spend, r.currency, r.metrics.spend);
  const kpis = computeKpis(ds.rows, ds.accounts, ds.apps);
  const tree = accounts.map((a) => {
    // The tree only needs row summaries; per-creative/geo detail is loaded in the drawer.
    const rows = ds.rows.filter((r) => r.advertiserId === a.advertiserId).map((r) => ({ ...r, creatives: [], geos: [] }));
    const apps: Array<{ app: AppRow | null; campaigns: CampaignRow[] }> = ds.apps
      .filter((p) => p.advertiserId === a.advertiserId)
      .map((app) => ({ app, campaigns: rows.filter((r) => r.appId === app.appId) }));
    const noApp = rows.filter((r) => !r.appId);
    if (noApp.length) apps.push({ app: null, campaigns: noApp });
    return { account: a, apps };
  });
  return {
    summary: {
      bcId: ds.bcId,
      adAccounts: ds.accounts.length,
      activeAccounts: ds.accounts.filter((a) => a.status === "STATUS_ENABLE").length,
      apps: ds.apps.length,
      runningApps: ds.apps.filter((a) => a.running).length,
      activeCampaigns: kpis.activeCampaigns,
      spend,
      roas: kpis.avgIaaRoas,
    },
    tree,
  };
}

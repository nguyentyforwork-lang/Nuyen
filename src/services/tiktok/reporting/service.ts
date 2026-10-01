import "server-only";
import { getAppConfig, getMcpConfig } from "@/lib/config";
import { TtlCache } from "@/lib/cache";
import { mapLimit } from "@/lib/semaphore";
import type { AdAccount, BusinessCenter, DateRange } from "@/types";
import { TikTokMcpError } from "../errors";
import { getMcpClient, type TikTokMcpClient } from "../mcp-client";
import { toolFor } from "../tool-registry";
import { IAA_UNAVAILABLE, type IaaMode } from "./aggregate";

/* ---------- raw TikTok shapes (only the fields we request) ---------- */

export interface RawCampaign {
  campaign_id: string;
  campaign_name: string;
  operation_status: string;
  secondary_status: string;
  budget: number;
  budget_mode: string;
  objective_type: string;
  app_promotion_type?: string;
  app_id?: string | null;
  campaign_automation_type?: string;
  budget_optimize_on?: boolean;
  modify_time?: string;
}

export interface RawApp {
  app_id: string;
  app_name: string;
  platform?: string;
  package_name?: string;
}

export interface ReportRow {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
}

interface Paged<T> {
  list: T[];
  page_info?: { page: number; total_page: number; total_number: number };
}

const CAMPAIGN_FIELDS = [
  "campaign_id",
  "campaign_name",
  "operation_status",
  "secondary_status",
  "budget",
  "budget_mode",
  "objective_type",
  "app_promotion_type",
  "app_id",
  "campaign_automation_type",
  "budget_optimize_on",
  "modify_time",
] as const;

export const BASE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "conversion",
  "cost_per_conversion",
  "app_install",
  "cost_per_app_install",
];

/**
 * TikTokMCPService. Every read the dashboard needs, mapped to discovered MCP tools.
 * Results are cached for APP_CACHE_TTL_SECONDS and tagged by advertiser / BC so writes can
 * invalidate exactly what they affect.
 */
export class TikTokMCPService {
  readonly cache: TtlCache;
  private iaaMode: IaaMode | null = null;
  private iaaResolving: Promise<IaaMode> | null = null;

  constructor(private readonly mcp: TikTokMcpClient) {
    const app = getAppConfig();
    this.cache = new TtlCache(app.APP_CACHE_TTL_SECONDS * 1000, app.APP_MIN_REFRESH_INTERVAL_SECONDS * 1000);
  }

  get client() {
    return this.mcp;
  }

  private cached<T>(key: string, tags: string[], load: () => Promise<T>, force?: boolean) {
    return this.cache.get(key, tags, load, { force });
  }

  /* ---------------- Business Centers & accounts ---------------- */

  async getBusinessCenters(force = false): Promise<BusinessCenter[]> {
    const { value } = await this.cached("bcs", ["bcs"], async () => {
      const out: BusinessCenter[] = [];
      for (let page = 1; ; page++) {
        const env = await this.mcp.call<Paged<{ bc_info: Record<string, string>; user_role: string; ext_user_role?: { finance_role?: string } }>>(
          toolFor("listBusinessCenters"),
          { page, page_size: 50 },
        );
        for (const r of env.data.list ?? []) {
          out.push({
            bcId: r.bc_info.bc_id,
            name: r.bc_info.name,
            currency: r.bc_info.currency,
            timezone: r.bc_info.timezone,
            status: r.bc_info.status,
            type: r.bc_info.type,
            userRole: r.user_role,
            financeRole: r.ext_user_role?.finance_role ?? null,
          });
        }
        if (page >= (env.data.page_info?.total_page ?? 1)) break;
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }, force);
    return value;
  }

  async getAdAccounts(bcId: string, force = false): Promise<AdAccount[]> {
    const { value } = await this.cached(`accounts:${bcId}`, [`bc:${bcId}`], async () => {
      const assets: Array<{ asset_id: string; asset_name: string; advertiser_role: string }> = [];
      for (let page = 1; ; page++) {
        const env = await this.mcp.call<Paged<{ asset_id: string; asset_name: string; advertiser_role: string }>>(
          toolFor("listBcAdAccounts"),
          { bc_id: bcId, asset_type: "ADVERTISER", page, page_size: 50 },
        );
        assets.push(...(env.data.list ?? []));
        if (page >= (env.data.page_info?.total_page ?? 1)) break;
      }
      const info = new Map<string, Record<string, string>>();
      for (let i = 0; i < assets.length; i += 100) {
        const ids = assets.slice(i, i + 100).map((a) => a.asset_id);
        const env = await this.mcp.call<{ list: Array<Record<string, string>> }>(toolFor("advertiserInfo"), {
          advertiser_ids: ids,
          fields: ["advertiser_id", "name", "currency", "timezone", "status"],
        });
        for (const r of env.data.list ?? []) info.set(r.advertiser_id, r);
      }
      return assets.map<AdAccount>((a) => {
        const i = info.get(a.asset_id);
        return {
          bcId,
          advertiserId: a.asset_id,
          name: i?.name ?? a.asset_name,
          currency: i?.currency ?? null,
          timezone: i?.timezone ?? null,
          status: i?.status ?? null,
          role: a.advertiser_role ?? null,
        };
      });
    }, force);
    return value;
  }

  /* ---------------- Campaigns & apps ---------------- */

  async getCampaigns(advertiserId: string, force = false): Promise<{ campaigns: RawCampaign[]; fetchedAt: number }> {
    const { value, storedAt } = await this.cached(`campaigns:${advertiserId}`, [`adv:${advertiserId}`], () =>
      this.fetchCampaigns(advertiserId), force);
    return { campaigns: value, fetchedAt: storedAt };
  }

  /** Uncached read of specific campaigns, used before and after every write. */
  async fetchCampaigns(advertiserId: string, campaignIds?: string[]): Promise<RawCampaign[]> {
    const out: RawCampaign[] = [];
    for (let page = 1; ; page++) {
      const env = await this.mcp.call<Paged<RawCampaign>>(toolFor("listCampaigns"), {
        advertiser_id: advertiserId,
        fields: [...CAMPAIGN_FIELDS],
        page,
        page_size: 1000,
        ...(campaignIds ? { filtering: { campaign_ids: campaignIds } } : {}),
      });
      out.push(...(env.data.list ?? []));
      if (page >= (env.data.page_info?.total_page ?? 1)) break;
    }
    return out;
  }

  async fetchSmartPlusCampaign(advertiserId: string, campaignId: string) {
    const env = await this.mcp.call<Paged<{ campaign_id: string; budget: number; operation_status: string; secondary_status: string; budget_mode: string }>>(
      toolFor("listSmartPlusCampaigns"),
      {
        advertiser_id: advertiserId,
        filtering: { campaign_ids: [campaignId] },
        fields: ["campaign_id", "budget", "budget_mode", "operation_status", "secondary_status"],
      },
    );
    return env.data.list?.[0] ?? null;
  }

  async getApps(advertiserId: string, force = false): Promise<RawApp[]> {
    const { value } = await this.cached(`apps:${advertiserId}`, [`adv:${advertiserId}`], async () => {
      const env = await this.mcp.call<{ apps?: RawApp[] }>(toolFor("listApps"), { advertiser_id: advertiserId });
      return env.data.apps ?? [];
    }, force);
    return value;
  }

  /** Ad-group-level app IDs for app campaigns that have no campaign-level app_id. */
  async getAdgroupAppIds(advertiserId: string, campaignIds: string[], force = false): Promise<Map<string, string>> {
    if (!campaignIds.length) return new Map();
    const key = `adgroupApps:${advertiserId}:${[...campaignIds].sort().join(",")}`;
    const { value } = await this.cached(key, [`adv:${advertiserId}`], async () => {
      const map: Array<[string, string]> = [];
      for (let i = 0; i < campaignIds.length; i += 100) {
        for (let page = 1; ; page++) {
          const env = await this.mcp.call<Paged<{ campaign_id: string; app_id?: string }>>(toolFor("listAdGroups"), {
            advertiser_id: advertiserId,
            fields: ["campaign_id", "app_id"],
            filtering: { campaign_ids: campaignIds.slice(i, i + 100) },
            page,
            page_size: 1000,
          });
          for (const ag of env.data.list ?? []) if (ag.app_id) map.push([ag.campaign_id, ag.app_id]);
          if (page >= (env.data.page_info?.total_page ?? 1)) break;
        }
      }
      return map;
    }, force);
    return new Map(value);
  }

  /* ---------------- Reports ---------------- */

  private async report(args: Record<string, unknown>): Promise<ReportRow[]> {
    const rows: ReportRow[] = [];
    for (let page = 1; ; page++) {
      const env = await this.mcp.call<Paged<ReportRow>>(toolFor("report"), { ...args, page, page_size: 1000 });
      rows.push(...(env.data.list ?? []));
      if (page >= (env.data.page_info?.total_page ?? 1)) break;
      if (page >= 20) break; // 20,000 rows: TikTok's own sync-report truncation point
    }
    return rows;
  }

  async getCampaignReport(advertiserId: string, range: DateRange, opts: { daily?: boolean; campaignIds?: string[]; force?: boolean } = {}) {
    const iaa = await this.resolveIaaMode(advertiserId);
    const metrics = [...BASE_METRICS, ...iaaMetrics(iaa)];
    const dims = opts.daily ? ["campaign_id", "stat_time_day"] : ["campaign_id"];
    const filtering = opts.campaignIds
      ? [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(opts.campaignIds) }]
      : undefined;
    const key = `rep:camp:${advertiserId}:${range.start}:${range.end}:${dims.join("+")}:${opts.campaignIds?.join(",") ?? "*"}`;
    const { value, storedAt } = await this.cached(key, [`adv:${advertiserId}`], () =>
      this.report({
        report_type: "BASIC",
        advertiser_id: advertiserId,
        data_level: "AUCTION_CAMPAIGN",
        dimensions: dims,
        metrics,
        start_date: range.start,
        end_date: range.end,
        ...(filtering ? { filtering } : {}),
      }), opts.force);
    return { rows: value, iaa, fetchedAt: storedAt };
  }

  async getGeoReport(advertiserId: string, range: DateRange, opts: { campaignIds?: string[]; force?: boolean } = {}) {
    const iaa = await this.resolveIaaMode(advertiserId);
    const filtering = opts.campaignIds
      ? [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(opts.campaignIds) }]
      : undefined;
    const key = `rep:geo:${advertiserId}:${range.start}:${range.end}:${opts.campaignIds?.join(",") ?? "*"}`;
    const { value } = await this.cached(key, [`adv:${advertiserId}`], () =>
      this.report({
        report_type: "AUDIENCE",
        advertiser_id: advertiserId,
        data_level: "AUCTION_CAMPAIGN",
        dimensions: ["campaign_id", "country_code"],
        metrics: ["spend", "impressions", "conversion", "app_install", ...iaaMetrics(iaa)],
        start_date: range.start,
        end_date: range.end,
        ...(filtering ? { filtering } : {}),
      }), opts.force);
    return { rows: value, iaa };
  }

  async getCreativeReport(advertiserId: string, range: DateRange, opts: { campaignIds?: string[]; force?: boolean } = {}) {
    const iaa = await this.resolveIaaMode(advertiserId);
    const filtering = opts.campaignIds
      ? [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(opts.campaignIds) }]
      : undefined;
    const key = `rep:ad:${advertiserId}:${range.start}:${range.end}:${opts.campaignIds?.join(",") ?? "*"}`;
    const { value } = await this.cached(key, [`adv:${advertiserId}`], () =>
      this.report({
        report_type: "BASIC",
        advertiser_id: advertiserId,
        data_level: "AUCTION_AD",
        dimensions: ["ad_id"],
        metrics: ["ad_name", "campaign_id", "adgroup_id", "spend", "impressions", "clicks", "conversion", "app_install", ...iaaMetrics(iaa)],
        start_date: range.start,
        end_date: range.end,
        ...(filtering ? { filtering } : {}),
      }), opts.force);
    return { rows: value, iaa };
  }

  /** Generic report used by the Reporting page (dimensions/metrics validated by caller). */
  async getCustomReport(advertiserId: string, args: { dataLevel: string; dimensions: string[]; metrics: string[]; range: DateRange; filtering?: unknown[]; reportType: "BASIC" | "AUDIENCE" }, force = false) {
    const key = `rep:custom:${advertiserId}:${JSON.stringify(args)}`;
    const { value, storedAt } = await this.cached(key, [`adv:${advertiserId}`], () =>
      this.report({
        report_type: args.reportType,
        advertiser_id: advertiserId,
        data_level: args.dataLevel,
        dimensions: args.dimensions,
        metrics: args.metrics,
        start_date: args.range.start,
        end_date: args.range.end,
        ...(args.filtering?.length ? { filtering: args.filtering } : {}),
      }), force);
    return { rows: value, fetchedAt: storedAt };
  }

  /**
   * Per-account spend for a BC (one call), used only to skip report calls for accounts with
   * no spend. Returns null when the BC report is not permitted. The caller then reports on
   * every account.
   */
  async getBcAccountSpend(bcId: string, range: DateRange, force = false): Promise<Map<string, number> | null> {
    try {
      const { value } = await this.cached(`bcspend:${bcId}:${range.start}:${range.end}`, [`bc:${bcId}`], async () => {
        const rows = await this.report({
          report_type: "BC",
          bc_id: bcId,
          dimensions: ["advertiser_id"],
          metrics: ["spend"],
          start_date: range.start,
          end_date: range.end,
        });
        return rows.map((r) => [r.dimensions.advertiser_id, Number.parseFloat(r.metrics.spend ?? "0") || 0] as [string, number]);
      }, force);
      return new Map(value);
    } catch (e) {
      if (e instanceof TikTokMcpError && e.kind === "RATE_LIMIT") throw e;
      return null;
    }
  }

  /* ---------------- IAA D0 metric resolution ---------------- */

  /**
   * Decides how IAA D0 ROAS is obtained. A configured metric name is used only after the
   * live TikTok API accepts it. Otherwise IAA is reported as unavailable (never substituted).
   */
  async resolveIaaMode(advertiserId: string): Promise<IaaMode> {
    if (this.iaaMode) return this.iaaMode;
    this.iaaResolving ??= (async () => {
      const cfg = getMcpConfig();
      const candidates: IaaMode[] = [];
      if (cfg.TIKTOK_IAA_D0_REVENUE_METRIC) candidates.push({ kind: "revenue_metric", metric: cfg.TIKTOK_IAA_D0_REVENUE_METRIC });
      if (cfg.TIKTOK_IAA_D0_ROAS_METRIC) {
        candidates.push({ kind: "official_roas_metric", metric: cfg.TIKTOK_IAA_D0_ROAS_METRIC, scale: cfg.TIKTOK_IAA_D0_ROAS_SCALE });
      }
      const rejected: string[] = [];
      for (const c of candidates) {
        if (c.kind === "unavailable") continue;
        try {
          await this.mcp.call(toolFor("report"), {
            report_type: "BASIC",
            advertiser_id: advertiserId,
            data_level: "AUCTION_ADVERTISER",
            dimensions: ["advertiser_id"],
            metrics: ["spend", c.metric],
            query_lifetime: true,
            page_size: 1,
          });
          return c;
        } catch (e) {
          if (e instanceof TikTokMcpError && (e.kind === "RATE_LIMIT" || e.kind === "TRANSPORT")) throw e;
          rejected.push(`${c.metric} (${(e as Error).message})`);
        }
      }
      return {
        kind: "unavailable",
        reason: rejected.length ? `${IAA_UNAVAILABLE}. Configured metric rejected by TikTok: ${rejected.join("; ")}` : IAA_UNAVAILABLE,
      } as IaaMode;
    })()
      .then((m) => (this.iaaMode = m))
      .finally(() => {
        this.iaaResolving = null;
      });
    return this.iaaResolving;
  }

  get currentIaaMode() {
    return this.iaaMode;
  }

  invalidateAdvertiser(advertiserId: string) {
    this.cache.invalidate(`adv:${advertiserId}`);
  }
}

export function iaaMetrics(mode: IaaMode): string[] {
  return mode.kind === "unavailable" ? [] : [mode.metric];
}

/** Reads accounts with bounded concurrency, collecting per-account failures instead of hiding them. */
export async function forEachAccount<T>(accounts: AdAccount[], fn: (a: AdAccount) => Promise<T>) {
  const results = await mapLimit(accounts, 4, async (a) => {
    try {
      return { account: a, ok: true as const, value: await fn(a) };
    } catch (e) {
      if (e instanceof TikTokMcpError && e.kind === "RATE_LIMIT") throw e;
      return { account: a, ok: false as const, error: e as Error };
    }
  });
  return results;
}

let service: TikTokMCPService | null = null;
export function getTikTokService(): TikTokMCPService {
  return (service ??= new TikTokMCPService(getMcpClient()));
}

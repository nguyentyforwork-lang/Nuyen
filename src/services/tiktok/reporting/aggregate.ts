import type { CampaignMetrics, CreativeRow, GeoRow, Iaa, Maybe, MoneyByCurrency, TopCreative } from "@/types";

export const IAA_UNAVAILABLE = "N/A — metric unavailable from current TikTok MCP reporting";

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export function emptyMetrics(): CampaignMetrics {
  return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, conversions: 0, costPerConversion: 0, installs: 0, cpi: 0 };
}

export function metricsFromReport(m: Record<string, unknown> | undefined): CampaignMetrics {
  if (!m) return emptyMetrics();
  return {
    spend: num(m.spend),
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    ctr: num(m.ctr),
    cpc: num(m.cpc),
    cpm: num(m.cpm),
    conversions: num(m.conversion),
    costPerConversion: num(m.cost_per_conversion),
    installs: num(m.app_install),
    cpi: num(m.cost_per_app_install),
  };
}

/** How IAA D0 metrics are obtained, decided once from the validated configuration. */
export type IaaMode =
  | { kind: "revenue_metric"; metric: string }
  | { kind: "official_roas_metric"; metric: string; scale: "ratio" | "percent" }
  | { kind: "unavailable"; reason: string };

export function iaaFromMetrics(mode: IaaMode, metrics: Record<string, unknown> | undefined, spend: number): Iaa {
  if (mode.kind === "unavailable") {
    return { roasPct: { ok: false, reason: mode.reason }, revenue: { ok: false, reason: mode.reason }, source: "unavailable" };
  }
  if (mode.kind === "revenue_metric") {
    const raw = metrics?.[mode.metric];
    if (raw === undefined || raw === null || raw === "" || raw === "-") {
      const reason = `${mode.metric} not returned for this row`;
      return { roasPct: { ok: false, reason }, revenue: { ok: false, reason }, source: "revenue_metric" };
    }
    const revenue = num(raw);
    return {
      revenue: { ok: true, value: revenue },
      roasPct: spend > 0 ? { ok: true, value: (revenue / spend) * 100 } : { ok: false, reason: "No spend in range" },
      source: "revenue_metric",
    };
  }
  const raw = metrics?.[mode.metric];
  if (raw === undefined || raw === null || raw === "" || raw === "-") {
    const reason = `${mode.metric} not returned for this row`;
    return { roasPct: { ok: false, reason }, revenue: { ok: false, reason: "Revenue metric not configured" }, source: "official_roas_metric" };
  }
  const v = num(raw);
  const pct = mode.scale === "ratio" ? v * 100 : v;
  return {
    roasPct: spend > 0 ? { ok: true, value: pct } : { ok: false, reason: "No spend in range" },
    revenue: spend > 0 ? { ok: true, value: (pct / 100) * spend } : { ok: false, reason: "No spend in range" },
    source: "official_roas_metric",
  };
}

/** Combines IAA across rows: total revenue / total spend. Only valid when every row has revenue. */
export function combineIaa(parts: Array<{ iaa: Iaa; spend: number }>, unavailableReason: string): Iaa {
  if (!parts.length) return { roasPct: { ok: false, reason: "No data" }, revenue: { ok: false, reason: "No data" }, source: "unavailable" };
  const source = parts[0].iaa.source;
  if (source === "unavailable") {
    return { roasPct: { ok: false, reason: unavailableReason }, revenue: { ok: false, reason: unavailableReason }, source };
  }
  let revenue = 0;
  let spend = 0;
  for (const p of parts) {
    if (p.spend === 0) continue;
    if (!p.iaa.revenue.ok) {
      const reason = `Revenue missing for part of the selection (${p.iaa.revenue.reason})`;
      return { roasPct: { ok: false, reason }, revenue: { ok: false, reason }, source };
    }
    revenue += p.iaa.revenue.value;
    spend += p.spend;
  }
  return {
    revenue: { ok: true, value: revenue },
    roasPct: spend > 0 ? { ok: true, value: (revenue / spend) * 100 } : { ok: false, reason: "No spend in range" },
    source,
  };
}

export type GeoSort = "spend" | "roas" | "conversions";

const roasOf = (iaa: Iaa) => (iaa.roasPct.ok ? iaa.roasPct.value : Number.NEGATIVE_INFINITY);

/** Top geo by the chosen key (default: highest spend). Ties broken by spend. */
export function topGeo(rows: GeoRow[], sort: GeoSort = "spend"): GeoRow | null {
  const withSpend = rows.filter((r) => r.spend > 0);
  if (!withSpend.length) return null;
  const key = (r: GeoRow) => (sort === "roas" ? roasOf(r.iaa) : sort === "conversions" ? r.conversions + r.installs : r.spend);
  return [...withSpend].sort((a, b) => key(b) - key(a) || b.spend - a.spend)[0];
}

/**
 * Top creative: only creatives with spend ≥ threshold qualify, so a $2 ad with 300% ROAS
 * cannot beat a $1,000 ad with 105% ROAS. Among qualifying creatives the highest IAA D0
 * ROAS wins when that metric is available, otherwise the highest spend.
 */
export function topCreative(rows: CreativeRow[], threshold: number): TopCreative {
  const qualifying = rows.filter((r) => r.spend >= threshold && r.spend > 0);
  if (!qualifying.length) {
    return { creative: null, basis: `No creative spent ≥ ${threshold.toFixed(2)} in range`, threshold };
  }
  const roasAvailable = qualifying.some((r) => r.iaa.roasPct.ok);
  if (roasAvailable) {
    const best = [...qualifying].sort((a, b) => roasOf(b.iaa) - roasOf(a.iaa) || b.spend - a.spend)[0];
    return { creative: best, basis: `Highest IAA D0 ROAS among creatives with spend ≥ ${threshold.toFixed(2)}`, threshold };
  }
  const best = [...qualifying].sort((a, b) => b.spend - a.spend)[0];
  return {
    creative: best,
    basis: `Highest spend among creatives with spend ≥ ${threshold.toFixed(2)} (IAA D0 ROAS unavailable)`,
    threshold,
  };
}

export function addMoney(target: MoneyByCurrency, currency: string | null, amount: number) {
  const c = currency ?? "UNKNOWN";
  target[c] = (target[c] ?? 0) + amount;
}

/** Average ROAS only when a single currency is involved; mixing currencies would be meaningless. */
export function averageRoas(parts: Array<{ iaa: Iaa; spend: number; currency: string | null }>, unavailableReason: string): Maybe<number> {
  const currencies = new Set(parts.filter((p) => p.spend > 0).map((p) => p.currency ?? "UNKNOWN"));
  if (currencies.size > 1) return { ok: false, reason: "Multiple currencies in selection — filter to one currency" };
  return combineIaa(parts, unavailableReason).roasPct;
}

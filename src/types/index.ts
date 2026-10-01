/** Domain types shared by server and UI. Never contain credentials. */

export type StatusBucket = "ACTIVE" | "PAUSED" | "NOT_DELIVERING" | "PENDING" | "DELETED" | "OTHER";
export const STATUS_FILTERS = ["ALL", "ACTIVE", "PAUSED", "NOT_DELIVERING", "PENDING", "DELETED"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface DateRange {
  preset: DatePreset;
  start: string; // YYYY-MM-DD (ad account time zone)
  end: string;
}
export const DATE_PRESETS = ["today", "yesterday", "last_3", "last_7", "last_14", "last_30", "custom"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface BusinessCenter {
  bcId: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  type: string;
  userRole: string;
  financeRole: string | null;
}

export interface AdAccount {
  bcId: string;
  advertiserId: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  role: string | null;
}

/** Value that is either known or explicitly unavailable with a reason. Never a guess. */
export type Maybe<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface Iaa {
  /** D0 IAA ROAS as a percentage (e.g. 103.5). */
  roasPct: Maybe<number>;
  revenue: Maybe<number>;
  source: "revenue_metric" | "official_roas_metric" | "unavailable";
}

export interface CampaignMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  costPerConversion: number;
  installs: number;
  cpi: number;
}

export interface GeoRow {
  countryCode: string;
  spend: number;
  conversions: number;
  installs: number;
  impressions: number;
  iaa: Iaa;
}

export interface CreativeRow {
  adId: string;
  adName: string | null;
  adgroupId: string | null;
  campaignId: string;
  spend: number;
  conversions: number;
  installs: number;
  impressions: number;
  clicks: number;
  iaa: Iaa;
}

export interface TopCreative {
  creative: CreativeRow | null;
  /** Why this one was chosen, or why none qualified. */
  basis: string;
  threshold: number;
}

export interface CampaignBudget {
  amount: number | null;
  mode: string;
  /** False when the budget lives on ad groups (e.g. BUDGET_MODE_INFINITE). */
  campaignLevel: boolean;
  label: string;
}

export interface CampaignRow {
  bcId: string;
  advertiserId: string;
  advertiserName: string;
  currency: string | null;
  timezone: string | null;
  appId: string | null;
  appName: string | null;
  appSource: "campaign" | "adgroup" | "none";
  campaignId: string;
  campaignName: string;
  objectiveType: string;
  automationType: string;
  operationStatus: string;
  secondaryStatus: string;
  statusBucket: StatusBucket;
  budget: CampaignBudget;
  metrics: CampaignMetrics;
  iaa: Iaa;
  topGeo: GeoRow | null;
  geos: GeoRow[];
  topCreative: TopCreative;
  creatives: CreativeRow[];
  /** Last day in the selected range with spend > 0 (null if none / range > 30 days). */
  lastActive: string | null;
  writeSupport: { budget: Maybe<true>; status: Maybe<true> };
  lastUpdated: string;
}

export interface AppRow {
  bcId: string;
  advertiserId: string;
  advertiserName: string;
  currency: string | null;
  appId: string | null;
  appName: string;
  activeCampaigns: number;
  totalCampaigns: number;
  spend: number;
  iaa: Iaa;
  topGeo: GeoRow | null;
  topCreative: TopCreative;
  lastActive: string | null;
  running: boolean;
  /** Distinct TikTok status buckets across the app's campaigns. */
  statusBuckets: StatusBucket[];
}

export interface MoneyByCurrency {
  [currency: string]: number;
}

export interface DashboardKpis {
  totalSpend: MoneyByCurrency;
  avgIaaRoas: Maybe<number>;
  activeCampaigns: number;
  activeApps: number;
  adAccounts: number;
}

export interface DataNotice {
  level: "info" | "warning" | "error";
  message: string;
}

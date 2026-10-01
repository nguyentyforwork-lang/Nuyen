/**
 * TEST-ONLY MCP replay server. Never used by the application in production.
 *
 * Exposes the subset of TikTok MCP tools the app uses, with the same names and required
 * parameters, and replays response shapes/values recorded from the real TikTok for Business
 * MCP server during discovery (2026-10-01). Writes mutate in-memory state so the
 * confirm → execute → verify → log flow can be exercised end-to-end in a browser.
 *
 * Usage: npx tsx tests/e2e/mcp-replay-server.mts   (listens on :4010/mcp)
 */
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TOKEN = process.env.REPLAY_TOKEN ?? "Bearer replay-test-token";
const PORT = Number(process.env.REPLAY_PORT ?? 4010);

/* ---------- recorded data (trimmed) ---------- */
const BC = { bc_id: "7689303456577044481", name: "Ignite x Ecomdy x AFS", currency: "USD", timezone: "Asia/Ho_Chi_Minh", status: "ENABLE", type: "AGENCY" };
const BC2 = { bc_id: "7218049161826992129", name: "Ecomdy Media Ltd (VN)", currency: "USD", timezone: "Asia/Ho_Chi_Minh", status: "ENABLE", type: "AGENCY" };
const accounts: Record<string, Array<{ id: string; name: string }>> = {
  [BC.bc_id]: [
    { id: "7689365713278615570", name: "Ignite 01" },
    { id: "7689367159012818962", name: "Ignite 02" },
  ],
  [BC2.bc_id]: [{ id: "7392895945995911169", name: "1011254_Fidget_Linh_Flower App_1721292733808" }],
};
const campaigns: Record<string, Array<Record<string, unknown>>> = {
  "7689365713278615570": [
    { campaign_id: "1877561075936257", campaign_name: "2809_Tungdx_Study in Barcelona_C2_GL_Purchase_Pangle", budget: 20.0, budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET", objective_type: "WEB_CONVERSIONS", app_promotion_type: "UNSET", operation_status: "ENABLE", secondary_status: "CAMPAIGN_STATUS_ENABLE", campaign_automation_type: "UPGRADED_SMART_PLUS", budget_optimize_on: true, modify_time: "2026-10-01 07:34:20" },
    { campaign_id: "1877560228458689", campaign_name: "Ecomdy test", budget: 20.0, budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET", objective_type: "WEB_CONVERSIONS", app_promotion_type: "UNSET", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE", campaign_automation_type: "UPGRADED_SMART_PLUS", budget_optimize_on: true },
    { campaign_id: "1877392976910482", campaign_name: "2609_Tungdx_IVF ES_US_Purchase", budget: 20.0, budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET", objective_type: "WEB_CONVERSIONS", app_promotion_type: "UNSET", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE", campaign_automation_type: "UPGRADED_SMART_PLUS", budget_optimize_on: true },
  ],
  "7689367159012818962": [],
  "7392895945995911169": [
    { campaign_id: "1808790157106194", campaign_name: "30/8 | DIY | iOS | MAI | TikTok | US New concept", budget: 0, budget_mode: "BUDGET_MODE_INFINITE", objective_type: "APP_PROMOTION", app_promotion_type: "APP_INSTALL", app_id: "7398664548137353234", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE", campaign_automation_type: "MANUAL" },
    { campaign_id: "1808616133446706", campaign_name: "28/8 | DIY | iOS | MAI | TikTok | Tier 1", budget: 0, budget_mode: "BUDGET_MODE_INFINITE", objective_type: "APP_PROMOTION", app_promotion_type: "APP_INSTALL", app_id: "7398664548137353234", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE", campaign_automation_type: "MANUAL" },
  ],
};
const apps: Record<string, unknown[]> = {
  "7392895945995911169": [{ app_id: "7398664548137353234", app_name: "Flower Language: DIY Wallpaper", platform: "IOS", package_name: "com.ezt.flower.wallpp" }],
};
const day = (d: string) => `${d} 00:00:00`;
const campaignDaily = [
  { dimensions: { campaign_id: "1877561075936257", stat_time_day: day("2026-09-29") }, metrics: { spend: "19.46", impressions: "52934", clicks: "19974", conversion: "376", app_install: "0", ctr: "37.73", cpc: "0.00", cpm: "0.37", cost_per_conversion: "0.05", cost_per_app_install: "0.00" } },
  { dimensions: { campaign_id: "1877561075936257", stat_time_day: day("2026-09-30") }, metrics: { spend: "18.91", impressions: "22053", clicks: "7999", conversion: "231", app_install: "0", ctr: "36.27", cpc: "0.00", cpm: "0.86", cost_per_conversion: "0.08", cost_per_app_install: "0.00" } },
];
const geo = [
  ["PH", "4.44", "60", "4547"],
  ["KH", "4.25", "91", "2486"],
  ["PK", "3.57", "18", "5205"],
  ["DZ", "2.36", "17", "4250"],
  ["MA", "1.04", "12", "1313"],
].map(([cc, spend, conv, imp]) => ({ dimensions: { campaign_id: "1877561075936257", country_code: cc }, metrics: { spend, conversion: conv, impressions: imp, app_install: "0" } }));
const ads = [
  { dimensions: { ad_id: "1877561447388209" }, metrics: { spend: "18.91", conversion: "231", impressions: "22053", clicks: "7999", app_install: "0", campaign_id: "1877561075936257", adgroup_id: "1877561089908994", ad_name: "828069250_122228786468908207_6271388514008329062_n_T9yWxFVS.jpg_Ad name2026-09-28 02:54:17" } },
  { dimensions: { ad_id: "1877561375043041" }, metrics: { spend: "0.00", conversion: "0", impressions: "0", clicks: "0", app_install: "0", campaign_id: "1877560228458689", adgroup_id: "1877560201730081", ad_name: "IVF ES 7_etinXmFC.mp4_Ad name2026-09-28 02:53:13" } },
];

/** Metrics the real API accepted during discovery; anything else is rejected with 40002 like TikTok. */
const VALID_METRICS = new Set(["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "conversion", "cost_per_conversion", "real_time_conversion", "app_install", "cost_per_app_install", "campaign_name", "adgroup_name", "ad_name", "campaign_id", "adgroup_id", "currency", "unique_ad_impression_events"]);

const ok = (data: unknown) => ({ code: 0, message: "OK", request_id: `replay-${Date.now()}`, data });
const err = (code: number, message: string) => ({ code, message, request_id: `replay-${Date.now()}`, data: {} });
const page = <T,>(list: T[]) => ({ list, page_info: { page: 1, page_size: list.length, total_number: list.length, total_page: 1 } });

function inRange(rows: typeof campaignDaily, start: string, end: string) {
  return rows.filter((r) => r.dimensions.stat_time_day.slice(0, 10) >= start && r.dimensions.stat_time_day.slice(0, 10) <= end);
}

function report(a: Record<string, unknown>) {
  const metrics = (a.metrics as string[]) ?? [];
  const bad = metrics.filter((m) => !VALID_METRICS.has(m));
  if (bad.length) return err(40002, `Please correct the information in invalid metric fields and try again. Invalid metric fields: ${JSON.stringify(bad)}. `);
  const filters = (a.filtering as Array<{ field_name: string; filter_value: string }>) ?? [];
  if (filters.some((f) => f.field_name === "country_code")) return err(40002, "Invalid value for filter field: country_code is not supported. ");
  const cids = filters.find((f) => f.field_name === "campaign_ids");
  const allow = cids ? new Set(JSON.parse(cids.filter_value)) : null;
  const dims = a.dimensions as string[];
  const start = String(a.start_date ?? "");
  const end = String(a.end_date ?? "");
  if (a.report_type === "BC") {
    const list = (accounts[String(a.bc_id)] ?? []).map((x) => ({ dimensions: { advertiser_id: x.id }, metrics: { spend: x.id === "7689365713278615570" && start <= "2026-09-30" ? "38.37" : "0.00", currency: "USD" } }));
    return ok(page(list));
  }
  if (a.advertiser_id !== "7689365713278615570") return ok(page([]));
  if (dims.includes("country_code")) return ok(page(geo.filter((g) => !allow || allow.has(g.dimensions.campaign_id))));
  if (dims.includes("ad_id")) return ok(page(ads.filter((g) => !allow || allow.has(g.metrics.campaign_id))));
  if (dims[0] === "advertiser_id") return ok(page([{ dimensions: { advertiser_id: String(a.advertiser_id) }, metrics: { spend: "38.37" } }]));
  const daily = inRange(campaignDaily, start, end).filter((r) => !allow || allow.has(r.dimensions.campaign_id));
  if (dims.includes("stat_time_day")) return ok(page(daily));
  const sum = new Map<string, Record<string, number>>();
  for (const r of daily) {
    const s = sum.get(r.dimensions.campaign_id) ?? {};
    for (const [k, v] of Object.entries(r.metrics)) s[k] = (s[k] ?? 0) + Number(v);
    sum.set(r.dimensions.campaign_id, s);
  }
  return ok(page([...sum].map(([id, m]) => ({ dimensions: { campaign_id: id }, metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.toFixed(2)])) }))));
}

function findCampaign(adv: string, id: string) {
  return campaigns[adv]?.find((c) => c.campaign_id === id);
}

const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  bc_get: () => ok({ ...page([BC, BC2].map((b) => ({ bc_info: b, user_role: "ADMIN", ext_user_role: { finance_role: "MANAGER" } }))) }),
  bc_asset_get: (a) => ok(page((accounts[String(a.bc_id)] ?? []).map((x) => ({ asset_id: x.id, asset_name: x.name, advertiser_role: "ADMIN", asset_type: "ADVERTISER" })))),
  advertiser_info_get: (a) =>
    ok({ list: (a.advertiser_ids as string[]).map((id) => ({ advertiser_id: id, name: Object.values(accounts).flat().find((x) => x.id === id)?.name ?? id, currency: "USD", timezone: "Asia/Ho_Chi_Minh", status: "STATUS_ENABLE" })) }),
  campaign_get: (a) => {
    const ids = (a.filtering as { campaign_ids?: string[] } | undefined)?.campaign_ids;
    const list = (campaigns[String(a.advertiser_id)] ?? []).filter((c) => !ids || ids.includes(String(c.campaign_id)));
    return ok(page(list.map((c) => ({ ...c }))));
  },
  smart_plus_campaign_get: (a) => handlers.campaign_get(a),
  app_list_get: (a) => ok({ apps: apps[String(a.advertiser_id)] ?? [] }),
  adgroup_get: () => ok(page([])),
  report_integrated_get: report,
  campaign_update: (a) => {
    const c = findCampaign(String(a.advertiser_id), String(a.campaign_id));
    if (!c) return err(40002, "campaign not found");
    if (c.campaign_automation_type === "UPGRADED_SMART_PLUS") return err(40002, "Use smart_plus endpoints for Upgraded Smart+ campaigns");
    c.budget = a.budget;
    return ok({ campaign_id: c.campaign_id });
  },
  smart_plus_campaign_update: (a) => {
    const c = findCampaign(String(a.advertiser_id), String(a.campaign_id));
    if (!c) return err(40002, "campaign not found");
    c.budget = a.budget;
    return ok({ campaign_id: c.campaign_id });
  },
  campaign_status_update: (a) => {
    for (const id of a.campaign_ids as string[]) {
      const c = findCampaign(String(a.advertiser_id), id);
      if (!c) return err(40002, "campaign not found");
      c.operation_status = a.operation_status;
      c.secondary_status = a.operation_status === "ENABLE" ? "CAMPAIGN_STATUS_ENABLE" : "CAMPAIGN_STATUS_DISABLE";
    }
    return ok({ campaign_ids: a.campaign_ids });
  },
};
handlers.smart_plus_campaign_status_update = handlers.campaign_status_update;

const REQUIRED: Record<string, string[]> = {
  bc_get: [],
  bc_asset_get: ["bc_id", "asset_type"],
  advertiser_info_get: ["advertiser_ids"],
  campaign_get: ["advertiser_id"],
  smart_plus_campaign_get: ["advertiser_id"],
  app_list_get: ["advertiser_id"],
  adgroup_get: ["advertiser_id"],
  report_integrated_get: ["report_type", "dimensions"],
  campaign_update: ["advertiser_id", "campaign_id"],
  smart_plus_campaign_update: ["advertiser_id", "campaign_id"],
  campaign_status_update: ["advertiser_id", "campaign_ids", "operation_status"],
  smart_plus_campaign_status_update: ["advertiser_id", "campaign_ids", "operation_status"],
};
const PROPS: Record<string, string[]> = {
  bc_get: ["page", "page_size", "bc_id"],
  bc_asset_get: ["bc_id", "asset_type", "page", "page_size", "filtering"],
  advertiser_info_get: ["advertiser_ids", "fields"],
  campaign_get: ["advertiser_id", "fields", "filtering", "page", "page_size"],
  smart_plus_campaign_get: ["advertiser_id", "fields", "filtering", "page", "page_size"],
  app_list_get: ["advertiser_id"],
  adgroup_get: ["advertiser_id", "fields", "filtering", "page", "page_size"],
  report_integrated_get: ["report_type", "dimensions", "metrics", "advertiser_id", "bc_id", "data_level", "start_date", "end_date", "filtering", "page", "page_size", "query_lifetime"],
  campaign_update: ["advertiser_id", "campaign_id", "budget", "campaign_name"],
  smart_plus_campaign_update: ["advertiser_id", "campaign_id", "budget"],
  campaign_status_update: ["advertiser_id", "campaign_ids", "operation_status"],
  smart_plus_campaign_status_update: ["advertiser_id", "campaign_ids", "operation_status"],
};

function mcpServer() {
  const server = new Server({ name: "tiktok-mcp-replay", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.keys(handlers).map((name) => ({
      name,
      description: `[replay] ${name}`,
      inputSchema: { type: "object", properties: Object.fromEntries(PROPS[name].map((p) => [p, {}])), required: REQUIRED[name] },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const h = handlers[req.params.name];
    const body = h ? h((req.params.arguments ?? {}) as Record<string, unknown>) : err(40000, "unknown tool");
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  return server;
}

createServer(async (req, res) => {
  if (req.headers.authorization !== TOKEN) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = mcpServer();
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}).listen(PORT, () => console.log(`MCP replay server on http://localhost:${PORT}/mcp`));

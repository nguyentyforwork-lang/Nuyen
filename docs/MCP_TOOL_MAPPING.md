# TikTok MCP Tool Mapping

This document records what was **discovered** from the official TikTok for Business MCP
server during implementation (2026-10-01). Nothing here was assumed: each mapping was
verified by inspecting the tool schema returned by the MCP server and, for read tools, by
making real read-only calls against the agency's accounts.

At runtime the app re-discovers tools with MCP `tools/list` and refuses to call any tool
that is not present (see `src/services/tiktok/tool-registry.ts`). The live mapping is
visible on the **MCP Status** page (`/settings/mcp`).

Discovery summary: the server exposes ~350 tools (full-disclosure endpoint). The token
used for discovery could access 42 Business Centers and 2,322 ad accounts.

## Feature → tool mapping

| Feature | MCP tool | Key params | Response fields used | Limitations |
|---|---|---|---|---|
| Business Centers | `bc_get` | `page`, `page_size` (≤50) | `bc_info.{bc_id,name,currency,timezone,status,type}`, `user_role`, `ext_user_role.finance_role` | – |
| Ad accounts in a BC | `bc_asset_get` | `bc_id`, `asset_type=ADVERTISER`, `page_size` (≤50) | `asset_id`, `asset_name`, `advertiser_role`, `advertiser_account_type` | Returns only assets the token's user can access |
| Ad account details | `advertiser_info_get` | `advertiser_ids[]`, `fields` | `name`, `currency`, `timezone`, `status`, `owner_bc_id` | – |
| All authorized accounts | `auth_advertiser_get` | – | `advertiser_id`, `advertiser_name` | 2,322 rows, no BC id; used only for diagnostics |
| Campaigns + status + budget | `campaign_get` | `advertiser_id`, `fields`, `filtering`, `page_size` (≤1000) | `campaign_id`, `campaign_name`, `operation_status`, `secondary_status`, `budget`, `budget_mode`, `objective_type`, `app_promotion_type`, `app_id`, `campaign_automation_type`, `budget_optimize_on`, `modify_time` | Deleted campaigns excluded by default. Includes `UPGRADED_SMART_PLUS` campaigns |
| Smart+ campaign read (for verification) | `smart_plus_campaign_get` | `advertiser_id`, `filtering.campaign_ids` | `budget`, `operation_status`, `secondary_status` | Upgraded Smart+ only |
| Apps (promoted apps) | `app_list_get` | `advertiser_id` | `app_id`, `app_name`, `platform`, `package_name`, `download_url` | Lists apps registered in the account (not "running" state) |
| App on ad group (fallback) | `adgroup_get` | `advertiser_id`, `filtering.campaign_ids`, `fields=[campaign_id,app_id]` | `app_id` | Used only when an APP_PROMOTION campaign has no campaign-level `app_id` |
| Campaign report | `report_integrated_get` | `report_type=BASIC`, `data_level=AUCTION_CAMPAIGN`, `dimensions=[campaign_id]` (+`stat_time_day`) | metrics below | `stat_time_day` max range 30 days; dates use ad account time zone |
| Geo breakdown | `report_integrated_get` | `report_type=AUDIENCE`, `data_level=AUCTION_CAMPAIGN`, `dimensions=[campaign_id,country_code]` | `spend`, `conversion`, `app_install`, `impressions` | Verified. `country_code` **cannot be used as a filter** (`40002 … country_code is not supported`), so geo filters are applied server-side. Unknown locations come back as `country_code: "None"`. Attribute metrics (`campaign_name`) are not requested on AUDIENCE reports |
| Creative report | `report_integrated_get` | `report_type=BASIC`, `data_level=AUCTION_AD`, `dimensions=[ad_id]`, optional `filtering` on `campaign_ids` / `ad_ids` (verified) | `ad_name`, `campaign_id`, `adgroup_id`, `spend`, `conversion`, … | "Creative" = ad. Up to 20,000 ads per sync report |
| BC spend pre-filter | `report_integrated_get` | `report_type=BC`, `bc_id`, `dimensions=[advertiser_id]` | `spend`, `currency`, `timezone` | Needs BC finance role on some BCs. Used only to skip report calls for zero-spend accounts; falls back to per-account reports on error |
| Campaign budget update (manual) | `campaign_update` | `advertiser_id`, `campaign_id`, `budget` | `code`, `message` | New budget must be ≥105% of current spend. Budget lock 23:55–00:00 account TZ |
| Campaign budget update (Upgraded Smart+) | `smart_plus_campaign_update` | `advertiser_id`, `campaign_id`, `budget` | `code`, `message` | Incremental update |
| Campaign ON/OFF (manual) | `campaign_status_update` | `advertiser_id`, `campaign_ids[]`, `operation_status=ENABLE\|DISABLE` | `code`, `message` | `DELETE` is never sent by this app |
| Campaign ON/OFF (Upgraded Smart+) | `smart_plus_campaign_status_update` | same | same | same |

Write tools are reachable only through the backend action endpoints (prepare → confirm → execute).

### Metrics verified on `report_integrated_get` (BASIC)

Valid: `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm`, `conversion`,
`cost_per_conversion`, `real_time_conversion`, `app_install`, `cost_per_app_install`,
`purchase`, `total_purchase_value`, `value_per_total_purchase`, `total_active_pay_roas`,
`complete_payment_roas`, `onsite_shopping_roas`, `total_onsite_shopping_value`,
`unique_ad_impression_events`, `cost_per_unique_ad_impression_event`, `app_event_add_to_cart`,
plus attribute metrics `campaign_name`, `adgroup_name`, `ad_name`, `currency`.

## IAA D0 ROAS — not available from the current MCP reporting

TikTok Ads Manager shows a "Day 0 Ad Revenue ROAS" column. **No IAA (in-app ad) revenue
metric was accepted by `report_integrated_get`.** The API rejects unknown metrics and names
them (`code 40002`, "Invalid metric fields: [...]"). These candidates were all rejected:

`ad_revenue`, `total_ad_revenue`, `ad_revenue_roas`, `in_app_ad_revenue`, `day0_ad_revenue`,
`day0_ad_revenue_roas`, `d0_ad_revenue`, `ad_revenue_d0`, `ad_revenue_roas_d0`,
`iaa_revenue`, `iaa_roas`, `total_ad_impression_value`, `ad_impression_roas`,
`value_per_ad_revenue`, `first_day_ad_revenue`, `first_day_ad_revenue_roas`,
`total_in_app_ad_revenue`, `in_app_ad_revenue_roas`, `skan_ad_revenue`, `real_time_ad_revenue`,
… (about 90 names in total, including `d0_`/`day0_`/`_day_0`/`_1d` variants).

TikTok's own `tiktok_ads_diagnosis_agent` suggested `in_app_ad_revenue`, `day0_ad_revenue`
and `day0_ad_revenue_roas`. The live API **rejected all three**, so they are not used.

`unique_ad_impression_events` (count of in-app ad impression events) is available, but it
is a count, not revenue, so it **cannot** be used to compute ROAS.

**What the app does:**

* By default every IAA D0 ROAS cell shows
  `N/A — metric unavailable from current TikTok MCP reporting`.
* If TikTok exposes the metric later, an admin can set `TIKTOK_IAA_D0_REVENUE_METRIC`
  (preferred: ROAS is then computed as `D0 IAA revenue / spend`) or
  `TIKTOK_IAA_D0_ROAS_METRIC` (the official ROAS metric). The server **validates the name
  against the live API** before using it. An invalid name is reported on the MCP Status page
  and the cells stay N/A. Nothing is substituted silently.
* Purchase ROAS metrics such as `total_active_pay_roas` are **not** used as a stand-in.

## Other unsupported or partially supported items

| Requirement | Status |
|---|---|
| Campaign budget when the campaign has `BUDGET_MODE_INFINITE` (budget lives on ad groups) | Shown as "Ad group budget". Campaign-level budget actions are blocked with an explanation; ad group budget editing is out of scope for this version |
| `SMART_PLUS` (legacy, non-upgraded) campaigns | Read-only. Write actions are blocked because no matching legacy Smart+ write tool was identified |
| Creative name | `ad_name` from the ad-level report. If empty, the ad ID is shown |
| Top creative "video ID" | Not in the ad report. The ad ID is used as the creative ID |
| App ID for non-app objectives | N/A (non-app campaign) |

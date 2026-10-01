# TikTok Ads Control Center

Internal agency dashboard for daily UA / campaign operation on TikTok Ads:
**report → monitor → diagnose → suggest → confirm → execute → audit.**

All data comes from the official **TikTok for Business MCP server**, nothing is mocked or
hardcoded, and every campaign-changing action needs an explicit, reviewed confirmation.

* Hierarchy: Business Center → Ad Account → App → Campaign → Ad Group → Creative
* Pages: Overview · Campaigns · Apps (+ App overview) · Accounts (+ account detail) ·
  Business Centers · Reporting · Rules · Actions Log · MCP Status
* Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn-style UI on Radix ·
  TanStack Table · Recharts · PostgreSQL (Drizzle) · `@modelcontextprotocol/sdk`

> **IAA D0 ROAS:** the current TikTok MCP reporting does not expose an IAA ad-revenue
> metric. About 90 candidate metric names were rejected by the live API. The dashboard
> therefore shows **"N/A — metric unavailable from current TikTok MCP reporting"** and never
> substitutes another ROAS. If TikTok adds the metric, set `TIKTOK_IAA_D0_REVENUE_METRIC`
> (or `TIKTOK_IAA_D0_ROAS_METRIC`); it is validated against the live API before use. Details:
> [`docs/MCP_TOOL_MAPPING.md`](docs/MCP_TOOL_MAPPING.md).

## Setup

```bash
npm install
cp .env.example .env.local          # fill in values (server-side only)
npm run hash-password -- nguyen 'a-strong-password'   # paste output into APP_USERS
openssl rand -hex 32                # paste into APP_SESSION_SECRET
DATABASE_URL=postgres://… npm run db:migrate
npm run build && npm start          # or: npm run dev
```

Open `/settings/mcp` first. It checks the configuration, the MCP connection, the
discovered tools, authentication (Business Center read), the feature → tool capability
map, and the IAA metric status.

### Configuration (three separate sections)

| Section | Variables |
|---|---|
| MCP | `TIKTOK_MCP_URL`, `TIKTOK_MCP_AUTH_HEADER`, `TIKTOK_MCP_AUTH_TOKEN`, `TIKTOK_MCP_EXTRA_HEADERS`, `TIKTOK_MCP_TIMEOUT_MS`, `TIKTOK_MCP_MAX_CONCURRENCY`, `TIKTOK_IAA_D0_*` |
| Database | `DATABASE_URL` |
| Application | `APP_TIMEZONE`, `APP_CACHE_TTL_SECONDS` (default 90), `APP_MIN_REFRESH_INTERVAL_SECONDS`, `APP_MAX_BUDGET_INCREASE_PCT` (50), `APP_MAX_BUDGET_DECREASE_PCT` (50), `APP_DEFAULT_MIN_CREATIVE_SPEND` (20), `APP_PENDING_ACTION_TTL_SECONDS` (300), `APP_AUTH_MODE`, `APP_USERS`, `APP_SESSION_SECRET`, `APP_SECURE_COOKIES` |

Use the official full-disclosure TikTok MCP endpoint, which exposes the complete tool set.
Tool names are never assumed: the app runs `tools/list` and refuses to call any tool that
was not discovered.

Auth modes: `password` (built-in login, scrypt hashes, HMAC-signed httpOnly SameSite=Strict
cookie) or `proxy_header` (trust an SSO proxy header; use it only when the app is reachable
solely through that proxy).

## Architecture

```
Browser (React)  ──fetch──▶  Next.js route handlers  ──▶  services  ──▶  TikTok MCP (server-side)
  no tokens                 auth + CSRF + validation      │
                                                          ├─ services/tiktok/reporting  READ (cached 90s)
                                                          ├─ services/tiktok/actions    WRITE (prepare→confirm)
                                                          ├─ services/rules             suggestions only
                                                          └─ db (Postgres)              audit, pending, rules
```

* `src/services/tiktok/mcp-client.ts`: MCP connection, tool discovery, concurrency cap,
  TikTok envelope parsing, error classification (rate limits, auth, invalid request).
* `src/services/tiktok/tool-registry.ts`: feature → discovered tool mapping, checked at runtime.
* `src/services/tiktok/reporting/service.ts`: **TikTokMCPService**: `getBusinessCenters`,
  `getAdAccounts`, `getCampaigns`, `getApps`, `getCampaignReport`, `getGeoReport`,
  `getCreativeReport`, `getBcAccountSpend`, IAA metric validation.
* `src/services/tiktok/actions/`: `engine.ts` (prepare/confirm/execute/verify/log),
  `safety.ts` (limits, TikTok constraints), `gateway.ts` (**the only module that calls
  write tools**: `updateCampaignBudget` / `updateCampaignStatus`).
* `src/services/dashboard/`: lazy dataset loading per BC/account, assembly, filtering, views.

### Read path & performance

Nothing loads until a BC is selected. Then: the BC's ad accounts load, then per account
(at most 4 in parallel) campaigns, apps, and reports. One BC-level report pre-filters
accounts with zero spend, so they get no report calls. Responses are cached in-process for
90 s with in-flight de-duplication. "Refresh Data" bypasses the cache, throttled to once
per 15 s per key. A successful write invalidates that account's cache entries. Filtering,
sorting, search and pagination happen server-side. The cache is per process, so a
multi-instance deployment needs a shared cache.

### Write path (every action)

1. **Click action** → modal (nothing is sent to TikTok).
2. **Prepare** (`POST /api/actions/prepare`): the backend re-reads live values from TikTok
   and returns current value, proposed value, change %, impact, warnings and blockers. It
   stores a single-use pending confirmation (expires after 5 min, bound to the operator).
3. **Confirm** (`POST /api/actions/confirm`): an atomic `PENDING→EXECUTING` claim, so
   double clicks or replays cannot run twice. The button shows "Executing..." and is disabled.
4. Each item is re-read. If the value changed since review, the item is **not executed**
   (STALE) and the attempt is logged.
5. The MCP write tool runs, then the backend **verifies by reading back from TikTok**.
   SUCCESS is shown only when TikTok returns the new value. Otherwise the result is
   VERIFICATION_FAILED or FAILED, with the reason.
6. The action is written to the audit log (operator, timestamp, BC, account, campaign,
   before/after/verified, MCP tool, request and response, source, batch, override). The
   table is **append-only**, enforced by a Postgres trigger.
7. The affected account's cache is invalidated and the UI refreshes. The button shows
   "Completed", or "Failed — Retry".

Safety: changes beyond **+50% / −50%** need an extra explicit acknowledgement, enforced
server-side. Other server-side checks:
* TikTok's "new budget ≥ 105% of today's spend" rule.
* The 23:55–00:00 budget lock window.
* Ad-group-level budgets (`BUDGET_MODE_INFINITE`) and deleted campaigns are blocked with an explanation.
* `DELETE` is never sent.
* Upgraded Smart+ campaigns are routed to the `smart_plus_*` tools.

Bulk actions show the full review table and run up to 100 campaigns per batch, each item
verified and logged.

### Rules

Rules (for example IAA D0 ROAS < 90% AND Spend > $100 → decrease budget 20%) only create
**Suggested Actions**. "Review & Confirm" opens the same confirmation flow. There is no
auto-execution. A condition on an unavailable metric never matches.

### Data notes

* Status is TikTok's own `secondary_status`, shown verbatim with a bucket for filtering
  (Active / Paused / Not delivering / Pending / Deleted). It is never inferred from spend.
* **Apps are derived** from `campaign.app_id`, falling back to the ad groups' `app_id`, and
  named via `app_list_get`. An app is **running** when at least one of its campaigns has status
  `CAMPAIGN_STATUS_ENABLE`.
* **Top Geo** = highest spend in range (sortable by ROAS or conversions). **Top Creative**
  only considers creatives (ads) with spend ≥ the configurable threshold (default 20).
  Among those it picks the highest IAA D0 ROAS when available, otherwise the highest spend.
* Every metric label carries the selected date range. Dates are in each ad account's time
  zone, and "Today" ranges show "Data may be delayed by TikTok reporting."
* Different currencies are never summed together.

## Testing

```bash
npm test                                   # unit tests (safety, engine, reporting, rules, export, auth, cache)
TEST_DATABASE_URL=postgres://… npm test    # + Postgres integration (atomic claim, append-only audit)
npm run lint && npm run typecheck
```

End-to-end browser smoke test (Phase 10) against a **test-only** MCP replay server. It uses
the same tool names and replays response shapes recorded from the real TikTok MCP, and it
is never used by the app itself:

```bash
npx tsx tests/e2e/mcp-replay-server.mts &          # :4010/mcp, token "Bearer replay-test-token"
# .env.local → TIKTOK_MCP_URL=http://localhost:4010/mcp, TIKTOK_MCP_AUTH_TOKEN="Bearer replay-test-token"
npm run build && npm start &
E2E_PASS=… npx tsx tests/e2e/smoke.mts
```

## Acceptance checklist

- [x] Select a BC → see its ad accounts → see currently running apps → select an app → see campaigns
- [x] Campaign IDs, spend, top geo, top creative (IAA D0 ROAS shown as N/A with the reason; see above)
- [x] Date filter (Today / Yesterday (default) / 3 / 7 / 14 / 30 days / custom), search, export (CSV/XLSX)
- [x] Increase / decrease budget, turn campaign OFF / ON, bulk actions
- [x] Every write needs confirmation. Results are verified, logged, and failures shown with the reason
- [x] No credentials in the frontend (checked in the build output and in the browser test). No mock data in production code
- [x] MCP tools discovered at runtime, not assumed

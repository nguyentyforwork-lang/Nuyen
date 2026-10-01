/**
 * Browser smoke test (Phase 10). Run against `next start` + tests/e2e/mcp-replay-server.mts:
 *   E2E_USER=nguyen E2E_PASS=… npx tsx tests/e2e/smoke.mts
 * Walks the agency workflow: login → select BC → campaigns → action with confirmation →
 * verify → action log → apps → accounts → BC tree → MCP status. Saves screenshots.
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? "e2e-screenshots";
const BC = "7689303456577044481";

const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`✓ ${msg}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

// Unauthenticated → login
await page.goto(`${BASE}/campaigns`);
assert(page.url().includes("/login"), "unauthenticated users are redirected to /login");
await page.fill('input[autocomplete="username"]', process.env.E2E_USER ?? "nguyen");
await page.fill('input[type="password"]', process.env.E2E_PASS ?? "");
await page.click('button[type="submit"]');
await page.waitForURL(/\/campaigns/);
assert(await page.evaluate(() => !document.cookie.includes("tacc_session")), "session cookie is httpOnly (not readable from JS)");
assert(await page.evaluate(() => Object.keys(localStorage).every((k) => !/token|secret|session/i.test(k))), "no credentials in localStorage");

// Select BC → table loads with default filters (Yesterday, Active)
await page.selectOption("select >> nth=0", BC);
await page.waitForSelector("text=Spend — Sep 30, 2026");
assert(await page.isVisible("text=Total Spend — Sep 30, 2026"), "KPI cards labelled with the date range");
assert(await page.isVisible("text=N/A — metric unavailable from current TikTok MCP reporting"), "IAA D0 ROAS unavailability is shown, not invented");
await shot(page, "01-campaigns-active-yesterday");

// Show all statuses
await page.selectOption('select:near(:text("Campaign Status"))', "ALL");
await page.waitForSelector("text=Ecomdy test");
await shot(page, "02-campaigns-all");

// Turn ON a paused campaign: modal → review → confirm → executing → completed
const row = page.locator("tr", { hasText: "Ecomdy test" });
await row.getByRole("button", { name: /ON/ }).click();
await page.waitForSelector("text=CONFIRM TURN ON");
assert(await page.isVisible("text=PAUSED (DISABLE)"), "modal shows current status");
assert(await page.isVisible("text=ACTIVE (ENABLE)"), "modal shows proposed status");
await shot(page, "03-confirm-turn-on");
await page.click("text=CONFIRM TURN ON");
await page.waitForSelector("text=Completed", { timeout: 30_000 });
assert(await page.isVisible("text=Verified: DISABLE → ENABLE"), "result verified against TikTok after execution");
await shot(page, "04-turn-on-completed");
await page.click("text=Completed");

// Budget decrease with +/- presets; exceeding the limit requires the extra checkbox
await page.locator("tr", { hasText: "Ecomdy test" }).getByRole("button").nth(1).click(); // decrease
await page.click("text=-30%");
assert(await page.isVisible("text=-30.0%"), "budget preview shows change %");
await page.fill('input[placeholder="%"]', "60");
await page.click("text=Review change");
await page.waitForSelector("text=Safety limit exceeded");
assert(await page.locator("button", { hasText: "CONFIRM BUDGET CHANGE" }).isDisabled(), "confirm disabled until limit override is acknowledged");
await shot(page, "05-budget-limit-override");
await page.click("text=CANCEL");

// Detail drawer
await page.locator("tr", { hasText: "Study in Barcelona" }).locator("td").nth(5).click();
await page.waitForSelector("text=Spend per day");
await page.waitForTimeout(500);
await shot(page, "06-campaign-drawer");
assert(await page.isVisible("text=Recent action history"), "drawer shows recent action history");
await page.keyboard.press("Escape");

// Bulk selection → review table
await page.locator('input[aria-label="Select page"]').check();
await page.click("text=/Bulk Actions/");
await page.click("role=menuitem[name='Increase Budget']");
await page.click("text=+10%");
await page.click("text=Review change");
await page.waitForSelector("text=CONFIRM BULK ACTION");
assert(await page.isVisible("text=Total campaigns affected:"), "bulk review shows total affected");
await shot(page, "07-bulk-review");
await page.click("text=CANCEL");

// Action log
await page.goto(`${BASE}/actions-log`);
await page.waitForSelector("text=Turn ON");
await shot(page, "08-actions-log");

// Apps → all apps for second BC (app derived from campaigns)
await page.goto(`${BASE}/apps?bcId=7218049161826992129&status=ALL`);
await page.waitForSelector("text=Flower Language: DIY Wallpaper");
await shot(page, "09-apps");

await page.goto(`${BASE}/accounts?bcId=${BC}`);
await page.waitForSelector("text=Ignite 01");
await shot(page, "10-accounts");

await page.goto(`${BASE}/business-centers?bcId=${BC}`);
await page.waitForSelector("text=Active accounts");
await shot(page, "11-business-center");

await page.goto(`${BASE}/settings/mcp`);
await page.waitForSelector("text=campaign_status_update");
await shot(page, "12-mcp-status");

await page.goto(`${BASE}/rules`);
await page.waitForSelector("text=Rule builder");
await page.click("text=Create Rule");
await page.waitForSelector("text=Recommendation only");
await shot(page, "13-rules");

await page.goto(`${BASE}/?bcId=${BC}`);
await page.waitForSelector("text=/Suggested actions|No campaign currently matches/");
await shot(page, "14-overview");

console.log("E2E smoke passed");
await browser.close();

import { describe, expect, it, beforeEach } from "vitest";
import { ActionEngine, type ActionStore, type CampaignGateway, type LiveCampaign, type LogInsert, type PendingRecord } from "@/services/tiktok/actions/engine";
import { TikTokMcpError } from "@/services/tiktok/errors";

/** In-memory fakes. Used ONLY in tests to exercise the confirmation/safety flow. */
class FakeStore implements ActionStore {
  pending = new Map<string, PendingRecord>();
  logs: Array<LogInsert & { id: string; status: string; errorMessage?: string | null; verifiedValue?: string | null }> = [];
  private n = 0;
  async createPending(p: Omit<PendingRecord, "id" | "status">) {
    const rec: PendingRecord = { ...p, id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`, status: "PENDING" };
    this.pending.set(rec.id, rec);
    return rec;
  }
  async claimPending(id: string, operator: string, now: Date) {
    const p = this.pending.get(id);
    if (!p || p.status !== "PENDING" || p.operator !== operator || p.expiresAt <= now) return null;
    p.status = "EXECUTING";
    return p;
  }
  async getPending(id: string) {
    return this.pending.get(id) ?? null;
  }
  async finishPending(id: string) {
    this.pending.get(id)!.status = "DONE";
  }
  async cancelPending(id: string) {
    const p = this.pending.get(id);
    if (!p || p.status !== "PENDING") return false;
    p.status = "CANCELLED";
    return true;
  }
  async insertLog(l: LogInsert) {
    const id = `log-${this.logs.length + 1}`;
    this.logs.push({ ...l, id });
    return id;
  }
  async completeLog(id: string, r: { status: string; verifiedValue: string | null; errorMessage: string | null }) {
    Object.assign(this.logs.find((l) => l.id === id)!, r);
  }
}

class FakeGateway implements CampaignGateway {
  campaigns = new Map<string, LiveCampaign>();
  writes: Array<{ kind: string; campaignId: string; value: unknown }> = [];
  failNextWrite: Error | null = null;
  ignoreWrites = false;
  spend = new Map<string, number>();
  lock = false;
  async readCampaigns(_adv: string, ids: string[]) {
    return ids.map((id) => this.campaigns.get(id)).filter((c): c is LiveCampaign => !!c).map((c) => ({ ...c }));
  }
  async accountContext(advertiserId: string) {
    return { advertiserId, timezone: "Asia/Ho_Chi_Minh", currency: "USD" };
  }
  async todaySpend() {
    return this.spend;
  }
  inLockWindow() {
    return this.lock;
  }
  budgetTool(c: LiveCampaign) {
    return c.automationType === "UPGRADED_SMART_PLUS" ? "smart_plus_campaign_update" : "campaign_update";
  }
  statusTool(c: LiveCampaign) {
    return c.automationType === "UPGRADED_SMART_PLUS" ? "smart_plus_campaign_status_update" : "campaign_status_update";
  }
  async updateBudget(c: LiveCampaign, _adv: string, budget: number) {
    if (this.failNextWrite) {
      const e = this.failNextWrite;
      this.failNextWrite = null;
      throw e;
    }
    this.writes.push({ kind: "budget", campaignId: c.campaignId, value: budget });
    if (!this.ignoreWrites) this.campaigns.get(c.campaignId)!.budget = budget;
    return { tool: this.budgetTool(c), request: { budget }, response: { code: 0 } };
  }
  async updateStatus(c: LiveCampaign, _adv: string, status: "ENABLE" | "DISABLE") {
    if (this.failNextWrite) {
      const e = this.failNextWrite;
      this.failNextWrite = null;
      throw e;
    }
    this.writes.push({ kind: "status", campaignId: c.campaignId, value: status });
    if (!this.ignoreWrites) this.campaigns.get(c.campaignId)!.operationStatus = status;
    return { tool: this.statusTool(c), request: { status }, response: { code: 0 } };
  }
  invalidated: string[] = [];
  invalidate(a: string) {
    this.invalidated.push(a);
  }
}

const camp = (id: string, over: Partial<LiveCampaign> = {}): LiveCampaign => ({
  campaignId: id,
  campaignName: `Campaign ${id}`,
  budget: 500,
  budgetMode: "BUDGET_MODE_DAY",
  operationStatus: "ENABLE",
  secondaryStatus: "CAMPAIGN_STATUS_ENABLE",
  automationType: "MANUAL",
  ...over,
});

const T = (id: string) => ({ bcId: "1", advertiserId: "100", campaignId: id });

describe("ActionEngine", () => {
  let gw: FakeGateway;
  let store: FakeStore;
  let engine: ActionEngine;
  let now: Date;

  beforeEach(() => {
    gw = new FakeGateway();
    store = new FakeStore();
    now = new Date("2026-10-01T03:00:00Z");
    engine = new ActionEngine(gw, store, { limits: { maxIncreasePct: 50, maxDecreasePct: 50 }, pendingTtlSeconds: 300, now: () => now });
    gw.campaigns.set("1", camp("1"));
    gw.campaigns.set("2", camp("2", { budget: 300 }));
    gw.campaigns.set("3", camp("3", { budget: 800, automationType: "UPGRADED_SMART_PLUS" }));
  });

  it("prepare never writes to TikTok and returns current vs proposed", async () => {
    const r = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 30 } });
    expect(gw.writes).toHaveLength(0);
    expect(store.logs).toHaveLength(0);
    expect(r.pendingId).toBeTruthy();
    expect(r.plan.items[0]).toMatchObject({ current: { budget: 500 }, proposed: { budget: 650 }, changePct: 30, tool: "campaign_update" });
  });

  it("confirm executes, verifies by reading back, and logs SUCCESS", async () => {
    const { pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 20 } });
    const res = await engine.confirm({ operator: "nguyen", pendingId: pendingId! });
    expect(res.results[0]).toMatchObject({ status: "SUCCESS", verifiedValue: "600" });
    expect(gw.writes).toEqual([{ kind: "budget", campaignId: "1", value: 600 }]);
    expect(store.logs[0]).toMatchObject({ operator: "nguyen", beforeValue: "500", afterValue: "600", status: "SUCCESS", mcpTool: "campaign_update", actionType: "BUDGET_INCREASE" });
    expect(gw.invalidated).toContain("100");
  });

  it("a confirmation can only be used once (duplicate clicks do nothing)", async () => {
    const { pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 10 } });
    await engine.confirm({ operator: "nguyen", pendingId: pendingId! });
    await expect(engine.confirm({ operator: "nguyen", pendingId: pendingId! })).rejects.toThrow(/already used/);
    expect(gw.writes).toHaveLength(1);
  });

  it("concurrent confirms execute once", async () => {
    const { pendingId } = await engine.prepareStatus({ operator: "nguyen", targets: [T("1")], action: "TURN_OFF" });
    const settled = await Promise.allSettled([engine.confirm({ operator: "nguyen", pendingId: pendingId! }), engine.confirm({ operator: "nguyen", pendingId: pendingId! })]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(gw.writes).toHaveLength(1);
  });

  it("expired confirmations cannot execute", async () => {
    const { pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "decrease", change: { type: "percent", value: 10 } });
    now = new Date(now.getTime() + 301_000);
    await expect(engine.confirm({ operator: "nguyen", pendingId: pendingId! })).rejects.toThrow(/expired/);
    expect(gw.writes).toHaveLength(0);
  });

  it("only the reviewing operator can confirm", async () => {
    const { pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "decrease", change: { type: "percent", value: 10 } });
    await expect(engine.confirm({ operator: "someone-else", pendingId: pendingId! })).rejects.toThrow(/Only the operator/);
    expect(gw.writes).toHaveLength(0);
  });

  it("changes above the safety limit require the extra explicit acknowledgement", async () => {
    const { pendingId, plan } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 80 } });
    expect(plan.requiresLimitOverride).toBe(true);
    await expect(engine.confirm({ operator: "nguyen", pendingId: pendingId! })).rejects.toThrow(/safety limit/);
    expect(gw.writes).toHaveLength(0);
    const res = await engine.confirm({ operator: "nguyen", pendingId: pendingId!, acknowledgeLimitOverride: true });
    expect(res.results[0].status).toBe("SUCCESS");
    expect(store.logs[0].limitOverride).toBe(true);
  });

  it("decrease beyond -50% also needs the override", async () => {
    const { plan } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "decrease", change: { type: "absolute", value: 200 } });
    expect(plan.items[0].changePct).toBe(-60);
    expect(plan.requiresLimitOverride).toBe(true);
  });

  it("does not execute if the live value changed since review (stale) and logs it", async () => {
    const { pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 10 } });
    gw.campaigns.get("1")!.budget = 999; // someone else changed it in Ads Manager
    const res = await engine.confirm({ operator: "nguyen", pendingId: pendingId! });
    expect(res.results[0].status).toBe("STALE");
    expect(gw.writes).toHaveLength(0);
    expect(store.logs[0]).toMatchObject({ status: "FAILED" });
    expect(store.logs[0].errorMessage).toMatch(/Not executed/);
  });

  it("never claims success when TikTok does not reflect the change", async () => {
    gw.ignoreWrites = true;
    const { pendingId } = await engine.prepareStatus({ operator: "nguyen", targets: [T("1")], action: "TURN_OFF" });
    const res = await engine.confirm({ operator: "nguyen", pendingId: pendingId! });
    expect(res.results[0].status).toBe("VERIFICATION_FAILED");
    expect(store.logs[0].status).toBe("VERIFICATION_FAILED");
  });

  it("records MCP errors as FAILED with the reason", async () => {
    gw.failNextWrite = new TikTokMcpError("RATE_LIMIT", "TikTok error 40100: Too many requests", { tiktokCode: 40100 });
    const { pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 10 } });
    const res = await engine.confirm({ operator: "nguyen", pendingId: pendingId! });
    expect(res.results[0]).toMatchObject({ status: "FAILED", message: "TikTok API/MCP rate limit reached. Please retry later." });
    expect(store.logs[0]).toMatchObject({ status: "FAILED", errorMessage: "TikTok API/MCP rate limit reached. Please retry later." });
  });

  it("bulk: reviews every campaign, executes each, logs each with a batch id", async () => {
    const { pendingId, plan } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1"), T("2"), T("3")], direction: "increase", change: { type: "percent", value: 20 } });
    expect(plan.items.map((i) => [i.current.budget, i.proposed.budget])).toEqual([
      [500, 600],
      [300, 360],
      [800, 960],
    ]);
    expect(plan.items[2].tool).toBe("smart_plus_campaign_update");
    const res = await engine.confirm({ operator: "nguyen", pendingId: pendingId! });
    expect(res.results.map((r) => r.status)).toEqual(["SUCCESS", "SUCCESS", "SUCCESS"]);
    expect(new Set(store.logs.map((l) => l.batchId)).size).toBe(1);
    expect(store.logs[0].source).toBe("BULK");
  });

  it("blocks ad-group-level budgets, deleted campaigns and the 105% spend rule", async () => {
    gw.campaigns.set("4", camp("4", { budget: null, budgetMode: "BUDGET_MODE_INFINITE" }));
    gw.spend.set("1", 480);
    const { plan, pendingId } = await engine.prepareBudget({ operator: "nguyen", targets: [T("1"), T("4")], direction: "decrease", change: { type: "percent", value: 10 } });
    expect(plan.items[0].blockers.join()).toMatch(/105%/);
    expect(plan.items[1].blockers.join()).toMatch(/ad group level/);
    expect(pendingId).toBeNull(); // nothing executable → nothing to confirm
  });

  it("status: turning off an already-paused campaign is blocked; turn on works", async () => {
    gw.campaigns.set("5", camp("5", { operationStatus: "DISABLE", secondaryStatus: "CAMPAIGN_STATUS_DISABLE" }));
    const off = await engine.prepareStatus({ operator: "nguyen", targets: [T("5")], action: "TURN_OFF" });
    expect(off.pendingId).toBeNull();
    const on = await engine.prepareStatus({ operator: "nguyen", targets: [T("5")], action: "TURN_ON" });
    expect(on.plan.items[0]).toMatchObject({ current: { operationStatus: "DISABLE" }, proposed: { operationStatus: "ENABLE" } });
    const res = await engine.confirm({ operator: "nguyen", pendingId: on.pendingId! });
    expect(res.results[0]).toMatchObject({ status: "SUCCESS", verifiedValue: "ENABLE" });
  });

  it("budget lock window blocks budget changes", async () => {
    gw.lock = true;
    const r = await engine.prepareBudget({ operator: "nguyen", targets: [T("1")], direction: "increase", change: { type: "percent", value: 10 } });
    expect(r.pendingId).toBeNull();
    expect(r.plan.items[0].blockers.join()).toMatch(/lock window/);
  });

  it("cancel prevents later execution", async () => {
    const { pendingId } = await engine.prepareStatus({ operator: "nguyen", targets: [T("1")], action: "TURN_OFF" });
    expect(await engine.cancel(pendingId!, "nguyen")).toBe(true);
    await expect(engine.confirm({ operator: "nguyen", pendingId: pendingId! })).rejects.toThrow();
    expect(gw.writes).toHaveLength(0);
  });
});

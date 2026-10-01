import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integration test against a real Postgres (skipped unless TEST_DATABASE_URL is set):
 *   TEST_DATABASE_URL=postgres://… npx vitest run tests/pg-store.test.ts
 * Verifies the single-use, race-free confirmation claim and the append-only audit trigger.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgActionStore (Postgres)", () => {
  let store: import("@/db/repo").PgActionStore;
  let sql: import("postgres").Sql;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url!);
    const { PgActionStore } = await import("@/db/repo");
    store = new PgActionStore();
    sql = (await import("postgres")).default(url!, { max: 1 });
  });
  afterAll(async () => {
    await sql?.end();
  });

  const plan = { kind: "STATUS", actionType: "TURN_OFF", items: [], limits: { maxIncreasePct: 50, maxDecreasePct: 50 }, executableCount: 0, requiresLimitOverride: false } as never;

  it("only one of many concurrent claims wins", async () => {
    const p = await store.createPending({ operator: "op", expiresAt: new Date(Date.now() + 60_000), requiresLimitOverride: false, source: "MANUAL", ruleId: null, plan });
    const claims = await Promise.all(Array.from({ length: 10 }, () => store.claimPending(p.id, "op", new Date())));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("expired or other-operator claims fail", async () => {
    const p = await store.createPending({ operator: "op", expiresAt: new Date(Date.now() - 1), requiresLimitOverride: false, source: "MANUAL", ruleId: null, plan });
    expect(await store.claimPending(p.id, "op", new Date())).toBeNull();
    const q = await store.createPending({ operator: "op", expiresAt: new Date(Date.now() + 60_000), requiresLimitOverride: false, source: "MANUAL", ruleId: null, plan });
    expect(await store.claimPending(q.id, "intruder", new Date())).toBeNull();
  });

  it("audit rows can record an outcome once and are never deletable", async () => {
    const id = await store.insertLog({
      operator: "op", bcId: null, advertiserId: "1", campaignId: "2", campaignName: "c", actionType: "TURN_OFF", beforeValue: "ENABLE", afterValue: "DISABLE",
      currency: null, status: "EXECUTING", mcpTool: "campaign_status_update", mcpRequest: {}, source: "MANUAL", batchId: null, pendingActionId: "00000000-0000-4000-8000-000000000001", ruleId: null, limitOverride: false,
    });
    await store.completeLog(id, { status: "SUCCESS", verifiedValue: "DISABLE", errorMessage: null, mcpResponse: { code: 0 } });
    await expect(store.completeLog(id, { status: "FAILED", verifiedValue: null, errorMessage: "tamper", mcpResponse: null })).rejects.toThrow();
    await expect(sql`delete from action_logs where id = ${id}`).rejects.toThrow(/append-only/);
  });
});

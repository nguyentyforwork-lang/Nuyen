import "server-only";
import { and, desc, eq, gt, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { ActionStore, LogInsert, PendingRecord, Plan } from "@/services/tiktok/actions/engine";
import { getDb } from "./client";
import { actionLogs, pendingActions, ruleDismissals, rules } from "./schema";

const toPending = (r: typeof pendingActions.$inferSelect): PendingRecord => ({
  id: r.id,
  operator: r.operator,
  status: r.status as PendingRecord["status"],
  expiresAt: r.expiresAt,
  requiresLimitOverride: r.requiresLimitOverride,
  source: r.source,
  ruleId: r.ruleId,
  plan: r.plan as Plan,
});

export class PgActionStore implements ActionStore {
  async createPending(p: Omit<PendingRecord, "id" | "status">) {
    const [row] = await getDb()
      .insert(pendingActions)
      .values({ operator: p.operator, expiresAt: p.expiresAt, requiresLimitOverride: p.requiresLimitOverride, source: p.source, ruleId: p.ruleId, plan: p.plan })
      .returning();
    return toPending(row);
  }

  async claimPending(id: string, operator: string, now: Date) {
    // Single atomic UPDATE: only one concurrent confirm can win.
    const [row] = await getDb()
      .update(pendingActions)
      .set({ status: "EXECUTING" })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "PENDING"), eq(pendingActions.operator, operator), gt(pendingActions.expiresAt, now)))
      .returning();
    return row ? toPending(row) : null;
  }

  async getPending(id: string) {
    const [row] = await getDb().select().from(pendingActions).where(eq(pendingActions.id, id));
    return row ? toPending(row) : null;
  }

  async finishPending(id: string) {
    await getDb().update(pendingActions).set({ status: "DONE" }).where(eq(pendingActions.id, id));
  }

  async cancelPending(id: string, operator: string) {
    const rows = await getDb()
      .update(pendingActions)
      .set({ status: "CANCELLED" })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "PENDING"), eq(pendingActions.operator, operator)))
      .returning({ id: pendingActions.id });
    return rows.length > 0;
  }

  async insertLog(l: LogInsert) {
    const [row] = await getDb().insert(actionLogs).values(l).returning({ id: actionLogs.id });
    return row.id;
  }

  async completeLog(id: string, r: { status: "SUCCESS" | "FAILED" | "VERIFICATION_FAILED"; verifiedValue: string | null; errorMessage: string | null; mcpResponse: unknown }) {
    await getDb()
      .update(actionLogs)
      .set({ status: r.status, verifiedValue: r.verifiedValue, errorMessage: r.errorMessage, mcpResponse: r.mcpResponse ?? null, completedAt: new Date() })
      .where(eq(actionLogs.id, id));
  }
}

export interface LogQuery {
  from?: string | null;
  to?: string | null;
  q?: string | null;
  status?: string | null;
  advertiserId?: string | null;
  campaignId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listActionLogs(f: LogQuery) {
  const conds = [];
  if (f.from) conds.push(gte(actionLogs.createdAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lte(actionLogs.createdAt, new Date(`${f.to}T23:59:59.999Z`)));
  if (f.status) conds.push(eq(actionLogs.status, f.status));
  if (f.advertiserId) conds.push(eq(actionLogs.advertiserId, f.advertiserId));
  if (f.campaignId) conds.push(eq(actionLogs.campaignId, f.campaignId));
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(or(ilike(actionLogs.campaignName, like), ilike(actionLogs.campaignId, like), ilike(actionLogs.operator, like), ilike(actionLogs.advertiserId, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const db = getDb();
  const [items, [{ count }]] = await Promise.all([
    db.select().from(actionLogs).where(where).orderBy(desc(actionLogs.createdAt)).limit(f.limit ?? 50).offset(f.offset ?? 0),
    db.select({ count: sql<number>`count(*)::int` }).from(actionLogs).where(where),
  ]);
  return { items, total: count };
}

/* ---------------- Rules ---------------- */

export async function listRules() {
  return getDb().select().from(rules).orderBy(desc(rules.createdAt));
}

export async function createRule(r: typeof rules.$inferInsert) {
  const [row] = await getDb().insert(rules).values({ ...r, mode: "RECOMMEND_ONLY" }).returning();
  return row;
}

export async function updateRule(id: string, patch: Partial<Pick<typeof rules.$inferInsert, "enabled" | "name" | "conditions" | "action" | "actionValue" | "bcId" | "advertiserId">>) {
  const [row] = await getDb().update(rules).set({ ...patch, updatedAt: new Date() }).where(eq(rules.id, id)).returning();
  return row ?? null;
}

export async function deleteRule(id: string) {
  await getDb().delete(rules).where(eq(rules.id, id));
}

export async function listDismissals(rangeKey: string) {
  return getDb().select().from(ruleDismissals).where(eq(ruleDismissals.rangeKey, rangeKey));
}

export async function dismissSuggestion(d: typeof ruleDismissals.$inferInsert) {
  await getDb().insert(ruleDismissals).values(d);
}

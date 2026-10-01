import { TikTokMcpError } from "../errors";
import {
  budgetMatches,
  evaluateBudgetChange,
  evaluateStatusChange,
  proposedBudget,
  round2,
  type ActionType,
  type BudgetChange,
  type Limits,
} from "./safety";

/* ------------------------------------------------------------------ */
/* Ports: TikTok access and persistence are injected (tested with fakes) */
/* ------------------------------------------------------------------ */

export interface LiveCampaign {
  campaignId: string;
  campaignName: string;
  budget: number | null;
  budgetMode: string;
  operationStatus: string;
  secondaryStatus: string;
  automationType: string;
}

export interface AccountContext {
  advertiserId: string;
  timezone: string;
  currency: string | null;
}

export interface CampaignGateway {
  readCampaigns(advertiserId: string, campaignIds: string[]): Promise<LiveCampaign[]>;
  accountContext(advertiserId: string): Promise<AccountContext>;
  /** Spend today in the account time zone, or null if TikTok could not report it. */
  todaySpend(advertiserId: string, campaignIds: string[], timezone: string): Promise<Map<string, number> | null>;
  inLockWindow(timezone: string): boolean;
  /** Returns the tool name and raw TikTok response. Throws TikTokMcpError on failure. */
  updateBudget(c: LiveCampaign, advertiserId: string, budget: number): Promise<{ tool: string; request: unknown; response: unknown }>;
  updateStatus(c: LiveCampaign, advertiserId: string, status: "ENABLE" | "DISABLE"): Promise<{ tool: string; request: unknown; response: unknown }>;
  budgetTool(c: LiveCampaign): string;
  statusTool(c: LiveCampaign): string;
  invalidate(advertiserId: string): void;
}

export interface PlanItem {
  bcId: string | null;
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  automationType: string;
  currency: string | null;
  timezone: string;
  actionType: ActionType;
  tool: string;
  current: { budget: number | null; budgetMode: string; operationStatus: string; secondaryStatus: string };
  proposed: { budget?: number; operationStatus?: "ENABLE" | "DISABLE" };
  changePct: number | null;
  exceedsLimit: boolean;
  blockers: string[];
  warnings: string[];
  impact: string;
}

export interface Plan {
  kind: "BUDGET" | "STATUS";
  actionType: ActionType;
  items: PlanItem[];
  limits: Limits;
  executableCount: number;
  requiresLimitOverride: boolean;
}

export interface PendingRecord {
  id: string;
  operator: string;
  status: "PENDING" | "EXECUTING" | "DONE" | "CANCELLED";
  expiresAt: Date;
  requiresLimitOverride: boolean;
  source: string;
  ruleId: string | null;
  plan: Plan;
}

export interface LogInsert {
  operator: string;
  bcId: string | null;
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  actionType: ActionType;
  beforeValue: string;
  afterValue: string;
  currency: string | null;
  status: "EXECUTING";
  mcpTool: string;
  mcpRequest: unknown;
  source: string;
  batchId: string | null;
  pendingActionId: string;
  ruleId: string | null;
  limitOverride: boolean;
}

export interface ActionStore {
  createPending(p: Omit<PendingRecord, "id" | "status">): Promise<PendingRecord>;
  /** Atomically moves PENDING → EXECUTING if not expired. Returns null if it could not claim. */
  claimPending(id: string, operator: string, now: Date): Promise<PendingRecord | null>;
  getPending(id: string): Promise<PendingRecord | null>;
  finishPending(id: string): Promise<void>;
  cancelPending(id: string, operator: string): Promise<boolean>;
  insertLog(l: LogInsert): Promise<string>;
  completeLog(id: string, r: { status: "SUCCESS" | "FAILED" | "VERIFICATION_FAILED"; verifiedValue: string | null; errorMessage: string | null; mcpResponse: unknown }): Promise<void>;
}

/* ------------------------------------------------------------------ */

export interface Target {
  bcId: string | null;
  advertiserId: string;
  campaignId: string;
}

const fmtMoney = (n: number | null, currency: string | null) =>
  n == null ? "N/A" : `${currency ?? ""} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

function groupByAdvertiser(targets: Target[]) {
  const by = new Map<string, Target[]>();
  for (const t of targets) by.set(t.advertiserId, [...(by.get(t.advertiserId) ?? []), t]);
  return by;
}

export class ActionEngine {
  constructor(
    private readonly gw: CampaignGateway,
    private readonly store: ActionStore,
    private readonly config: { limits: Limits; pendingTtlSeconds: number; now?: () => Date },
  ) {}

  private now() {
    return this.config.now?.() ?? new Date();
  }

  /** Step 1: read live values from TikTok and build a reviewable plan. Never writes to TikTok. */
  async prepareBudget(input: {
    operator: string;
    targets: Target[];
    direction: "increase" | "decrease";
    change: BudgetChange;
    source?: string;
    ruleId?: string | null;
  }) {
    if (!input.targets.length) throw new TikTokMcpError("INVALID_REQUEST", "No campaigns selected");
    if (input.targets.length > 100) throw new TikTokMcpError("INVALID_REQUEST", "Bulk actions are limited to 100 campaigns at a time");
    if (!(input.change.value > 0)) throw new TikTokMcpError("INVALID_REQUEST", "Change value must be greater than 0");
    const actionType: ActionType = input.direction === "increase" ? "BUDGET_INCREASE" : "BUDGET_DECREASE";
    const items: PlanItem[] = [];
    for (const [advertiserId, targets] of groupByAdvertiser(input.targets)) {
      const ctx = await this.gw.accountContext(advertiserId);
      const live = new Map((await this.gw.readCampaigns(advertiserId, targets.map((t) => t.campaignId))).map((c) => [c.campaignId, c]));
      const spend = await this.gw.todaySpend(advertiserId, targets.map((t) => t.campaignId), ctx.timezone);
      const lock = this.gw.inLockWindow(ctx.timezone);
      for (const t of targets) {
        const c = live.get(t.campaignId);
        if (!c) {
          items.push(missingItem(t, ctx, actionType));
          continue;
        }
        const blockers: string[] = [];
        const warnings: string[] = [];
        let proposed: number | undefined;
        let changePct: number | null = null;
        let exceedsLimit = false;
        if (c.budget == null || c.budgetMode === "BUDGET_MODE_INFINITE" || !(c.budget > 0)) {
          blockers.push("Budget is set at ad group level (campaign has no campaign-level budget)");
        } else if (!["MANUAL", "UPGRADED_SMART_PLUS"].includes(c.automationType)) {
          blockers.push(`Budget changes are not supported for ${c.automationType} campaigns via the current MCP tools`);
        } else {
          proposed = proposedBudget(c.budget, input.direction, input.change);
          const ev = evaluateBudgetChange({
            current: c.budget,
            proposed,
            direction: input.direction,
            limits: this.config.limits,
            todaySpend: spend ? (spend.get(c.campaignId) ?? 0) : null,
            inLockWindow: lock,
          });
          blockers.push(...ev.blockers);
          warnings.push(...ev.warnings);
          changePct = ev.changePct;
          exceedsLimit = ev.exceedsLimit;
        }
        if (c.budgetMode === "BUDGET_MODE_TOTAL") warnings.push("This is a lifetime budget");
        items.push({
          bcId: t.bcId,
          advertiserId,
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          automationType: c.automationType,
          currency: ctx.currency,
          timezone: ctx.timezone,
          actionType,
          tool: this.gw.budgetTool(c),
          current: { budget: c.budget, budgetMode: c.budgetMode, operationStatus: c.operationStatus, secondaryStatus: c.secondaryStatus },
          proposed: proposed !== undefined ? { budget: proposed } : {},
          changePct,
          exceedsLimit,
          blockers,
          warnings,
          impact:
            proposed !== undefined
              ? `Budget ${fmtMoney(c.budget, ctx.currency)} → ${fmtMoney(proposed, ctx.currency)} (${changePct! > 0 ? "+" : ""}${changePct}%, ${round2(proposed - c.budget!) > 0 ? "+" : ""}${fmtMoney(round2(proposed - c.budget!), ctx.currency)})`
              : "No change possible",
        });
      }
    }
    return this.persistPlan(input.operator, { kind: "BUDGET", actionType, items }, input.source, input.ruleId);
  }

  async prepareStatus(input: { operator: string; targets: Target[]; action: "TURN_ON" | "TURN_OFF"; source?: string; ruleId?: string | null }) {
    if (!input.targets.length) throw new TikTokMcpError("INVALID_REQUEST", "No campaigns selected");
    if (input.targets.length > 100) throw new TikTokMcpError("INVALID_REQUEST", "Bulk actions are limited to 100 campaigns at a time");
    const items: PlanItem[] = [];
    for (const [advertiserId, targets] of groupByAdvertiser(input.targets)) {
      const ctx = await this.gw.accountContext(advertiserId);
      const live = new Map((await this.gw.readCampaigns(advertiserId, targets.map((t) => t.campaignId))).map((c) => [c.campaignId, c]));
      for (const t of targets) {
        const c = live.get(t.campaignId);
        if (!c) {
          items.push(missingItem(t, ctx, input.action));
          continue;
        }
        const ev = evaluateStatusChange(c.operationStatus, c.secondaryStatus, input.action);
        const blockers = [...ev.blockers];
        if (!["MANUAL", "UPGRADED_SMART_PLUS"].includes(c.automationType)) {
          blockers.push(`Status changes are not supported for ${c.automationType} campaigns via the current MCP tools`);
        }
        items.push({
          bcId: t.bcId,
          advertiserId,
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          automationType: c.automationType,
          currency: ctx.currency,
          timezone: ctx.timezone,
          actionType: input.action,
          tool: this.gw.statusTool(c),
          current: { budget: c.budget, budgetMode: c.budgetMode, operationStatus: c.operationStatus, secondaryStatus: c.secondaryStatus },
          proposed: { operationStatus: ev.target as "ENABLE" | "DISABLE" },
          changePct: null,
          exceedsLimit: false,
          blockers,
          warnings: ev.warnings,
          impact: `${c.operationStatus} → ${ev.target}`,
        });
      }
    }
    return this.persistPlan(input.operator, { kind: "STATUS", actionType: input.action, items }, input.source, input.ruleId);
  }

  private async persistPlan(operator: string, p: Pick<Plan, "kind" | "actionType" | "items">, source = "MANUAL", ruleId: string | null = null) {
    const executable = p.items.filter((i) => !i.blockers.length);
    const plan: Plan = {
      ...p,
      limits: this.config.limits,
      executableCount: executable.length,
      requiresLimitOverride: executable.some((i) => i.exceedsLimit),
    };
    if (!executable.length) return { pendingId: null as string | null, plan, expiresAt: null as string | null };
    const rec = await this.store.createPending({
      operator,
      expiresAt: new Date(this.now().getTime() + this.config.pendingTtlSeconds * 1000),
      requiresLimitOverride: plan.requiresLimitOverride,
      source: p.items.length > 1 && source === "MANUAL" ? "BULK" : source,
      ruleId,
      plan,
    });
    return { pendingId: rec.id, plan, expiresAt: rec.expiresAt.toISOString() };
  }

  async cancel(pendingId: string, operator: string) {
    return this.store.cancelPending(pendingId, operator);
  }

  /**
   * Step 2: executes a reviewed plan once the operator confirms. The pending record is claimed
   * atomically, so double clicks or replays cannot execute twice. Each item is re-read from
   * TikTok first: if the live value changed since review, that item is skipped as STALE.
   */
  async confirm(input: { operator: string; pendingId: string; acknowledgeLimitOverride?: boolean }) {
    const existing = await this.store.getPending(input.pendingId);
    if (!existing) throw new TikTokMcpError("INVALID_REQUEST", "Confirmation not found");
    if (existing.operator !== input.operator) throw new TikTokMcpError("INVALID_REQUEST", "Only the operator who reviewed this action can confirm it");
    if (existing.requiresLimitOverride && !input.acknowledgeLimitOverride) {
      throw new TikTokMcpError("INVALID_REQUEST", "This change exceeds the safety limit and needs the additional explicit warning confirmation");
    }
    const pending = await this.store.claimPending(input.pendingId, input.operator, this.now());
    if (!pending) throw new TikTokMcpError("INVALID_REQUEST", "This confirmation was already used, cancelled or has expired. Review the action again");

    const batchId = pending.plan.items.length > 1 ? pending.id : null;
    const results: Array<{ campaignId: string; advertiserId: string; status: string; message: string; verifiedValue: string | null; logId: string | null }> = [];
    try {
      for (const item of pending.plan.items) {
        if (item.blockers.length) {
          results.push({ campaignId: item.campaignId, advertiserId: item.advertiserId, status: "SKIPPED", message: item.blockers.join("; "), verifiedValue: null, logId: null });
          continue;
        }
        results.push(await this.executeItem(item, pending, batchId, !!input.acknowledgeLimitOverride));
      }
    } finally {
      await this.store.finishPending(pending.id);
      for (const adv of new Set(pending.plan.items.map((i) => i.advertiserId))) this.gw.invalidate(adv);
    }
    return { pendingId: pending.id, batchId, results };
  }

  private async executeItem(item: PlanItem, pending: PendingRecord, batchId: string | null, override: boolean) {
    const base = { campaignId: item.campaignId, advertiserId: item.advertiserId };
    const isBudget = pending.plan.kind === "BUDGET";
    const before = isBudget ? String(item.current.budget) : item.current.operationStatus;
    const after = isBudget ? String(item.proposed.budget) : String(item.proposed.operationStatus);

    // Re-read live state immediately before writing (stale-review protection).
    let live: LiveCampaign | undefined;
    try {
      [live] = await this.gw.readCampaigns(item.advertiserId, [item.campaignId]);
    } catch (e) {
      return { ...base, status: "FAILED", message: `Could not re-read campaign before executing: ${errMsg(e)}`, verifiedValue: null, logId: null };
    }
    const stale = !live
      ? "Campaign no longer found"
      : isBudget
        ? !budgetMatches(live.budget, item.current.budget!) && `Budget changed since review (now ${live.budget})`
        : live.operationStatus !== item.current.operationStatus && `Status changed since review (now ${live.operationStatus})`;
    const logBase = {
      operator: pending.operator,
      bcId: item.bcId,
      advertiserId: item.advertiserId,
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      actionType: item.actionType,
      beforeValue: before,
      afterValue: after,
      currency: item.currency,
      status: "EXECUTING",
      mcpTool: !live ? item.tool : isBudget ? this.gw.budgetTool(live) : this.gw.statusTool(live),
      mcpRequest: isBudget ? { budget: item.proposed.budget } : { operation_status: item.proposed.operationStatus },
      source: pending.source,
      batchId,
      pendingActionId: pending.id,
      ruleId: pending.ruleId,
      limitOverride: override && item.exceedsLimit,
    } as const;

    if (stale) {
      // Confirmed but not executed: still recorded for accountability.
      const message = `${stale}. Not executed. Review again`;
      const staleLog = await this.store.insertLog({ ...logBase, mcpTool: item.tool });
      await this.store.completeLog(staleLog, { status: "FAILED", verifiedValue: live ? (isBudget ? String(live.budget) : live.operationStatus) : null, errorMessage: message, mcpResponse: null });
      return { ...base, status: "STALE", message, verifiedValue: null, logId: staleLog };
    }

    const logId = await this.store.insertLog(logBase);

    let response: unknown;
    try {
      const r = isBudget
        ? await this.gw.updateBudget(live!, item.advertiserId, item.proposed.budget!)
        : await this.gw.updateStatus(live!, item.advertiserId, item.proposed.operationStatus!);
      response = r.response;
    } catch (e) {
      const message = errMsg(e);
      await this.store.completeLog(logId, { status: "FAILED", verifiedValue: null, errorMessage: message, mcpResponse: (e as TikTokMcpError).details?.raw ?? null });
      return { ...base, status: "FAILED", message, verifiedValue: null, logId };
    }

    // Verify by reading back from TikTok. Success is only claimed if TikTok shows the new value.
    let verified: LiveCampaign | undefined;
    try {
      [verified] = await this.gw.readCampaigns(item.advertiserId, [item.campaignId]);
    } catch (e) {
      const message = `TikTok accepted the request but verification read failed: ${errMsg(e)}`;
      await this.store.completeLog(logId, { status: "VERIFICATION_FAILED", verifiedValue: null, errorMessage: message, mcpResponse: response });
      return { ...base, status: "VERIFICATION_FAILED", message, verifiedValue: null, logId };
    }
    const verifiedValue = verified ? (isBudget ? String(verified.budget) : verified.operationStatus) : null;
    const ok = verified && (isBudget ? budgetMatches(verified.budget, item.proposed.budget!) : verified.operationStatus === item.proposed.operationStatus);
    if (!ok) {
      const message = `TikTok returned ${verifiedValue ?? "nothing"} after the update; expected ${after}`;
      await this.store.completeLog(logId, { status: "VERIFICATION_FAILED", verifiedValue, errorMessage: message, mcpResponse: response });
      return { ...base, status: "VERIFICATION_FAILED", message, verifiedValue, logId };
    }
    await this.store.completeLog(logId, { status: "SUCCESS", verifiedValue, errorMessage: null, mcpResponse: response });
    return { ...base, status: "SUCCESS", message: `Verified: ${before} → ${verifiedValue}`, verifiedValue, logId };
  }
}

function missingItem(t: Target, ctx: AccountContext, actionType: ActionType): PlanItem {
  return {
    bcId: t.bcId,
    advertiserId: t.advertiserId,
    campaignId: t.campaignId,
    campaignName: "(not found)",
    automationType: "UNKNOWN",
    currency: ctx.currency,
    timezone: ctx.timezone,
    actionType,
    tool: "-",
    current: { budget: null, budgetMode: "UNKNOWN", operationStatus: "UNKNOWN", secondaryStatus: "UNKNOWN" },
    proposed: {},
    changePct: null,
    exceedsLimit: false,
    blockers: ["Campaign not found in TikTok (deleted or no access)"],
    warnings: [],
    impact: "No change possible",
  };
}

const errMsg = (e: unknown) => (e instanceof TikTokMcpError ? e.userMessage : (e as Error)?.message ?? String(e));

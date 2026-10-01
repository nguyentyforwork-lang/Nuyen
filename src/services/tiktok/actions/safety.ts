/** Pure safety logic for write actions. No I/O, fully unit-tested. */

export type ActionType = "BUDGET_INCREASE" | "BUDGET_DECREASE" | "TURN_ON" | "TURN_OFF";

export interface BudgetChange {
  /** "percent": +20 means +20%. "absolute": the new budget amount. */
  type: "percent" | "absolute";
  value: number;
}

export interface Limits {
  maxIncreasePct: number;
  maxDecreasePct: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function proposedBudget(current: number, direction: "increase" | "decrease", change: BudgetChange): number {
  if (change.type === "absolute") return round2(change.value);
  const pct = Math.abs(change.value);
  return round2(direction === "increase" ? current * (1 + pct / 100) : current * (1 - pct / 100));
}

export interface BudgetEvaluation {
  current: number;
  proposed: number;
  changePct: number;
  exceedsLimit: boolean;
  blockers: string[];
  warnings: string[];
}

export function evaluateBudgetChange(input: {
  current: number;
  proposed: number;
  direction: "increase" | "decrease";
  limits: Limits;
  /** Spend so far today (account TZ). TikTok requires new budget ≥ 105% of it. Null = unknown. */
  todaySpend: number | null;
  inLockWindow: boolean;
}): BudgetEvaluation {
  const { current, proposed, direction, limits, todaySpend } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const changePct = current > 0 ? round2(((proposed - current) / current) * 100) : 0;

  if (!(current > 0)) blockers.push("Current campaign budget is unknown or zero");
  if (!Number.isFinite(proposed) || proposed <= 0) blockers.push("New budget must be greater than 0");
  if (direction === "increase" && proposed <= current) blockers.push("New budget must be higher than the current budget for an increase");
  if (direction === "decrease" && proposed >= current) blockers.push("New budget must be lower than the current budget for a decrease");
  if (todaySpend !== null && proposed < round2(todaySpend * 1.05)) {
    blockers.push(`TikTok requires the new budget to be at least 105% of today's spend (${round2(todaySpend * 1.05)})`);
  }
  if (todaySpend === null) warnings.push("Today's spend could not be read; TikTok will reject budgets below 105% of today's spend");
  if (input.inLockWindow) blockers.push("TikTok budget lock window (23:55–00:00 in the ad account time zone). Try again after midnight");

  const exceedsLimit =
    (direction === "increase" && changePct > limits.maxIncreasePct) ||
    (direction === "decrease" && -changePct > limits.maxDecreasePct);
  if (exceedsLimit) {
    warnings.push(
      direction === "increase"
        ? `Change of +${changePct}% exceeds the +${limits.maxIncreasePct}% single-change safety limit`
        : `Change of ${changePct}% exceeds the -${limits.maxDecreasePct}% single-change safety limit`,
    );
  }
  return { current, proposed, changePct, exceedsLimit, blockers, warnings };
}

export function evaluateStatusChange(currentOperationStatus: string, secondaryStatus: string, action: "TURN_ON" | "TURN_OFF") {
  const blockers: string[] = [];
  const target = action === "TURN_ON" ? "ENABLE" : "DISABLE";
  if (secondaryStatus === "CAMPAIGN_STATUS_DELETE") blockers.push("Campaign is deleted");
  if (currentOperationStatus === target) blockers.push(`Campaign is already ${action === "TURN_ON" ? "ON (ENABLE)" : "OFF (DISABLE)"}`);
  return {
    target,
    blockers,
    warnings: action === "TURN_OFF" ? ["This will stop campaign delivery."] : ["This will resume campaign delivery and spending."],
  };
}

export function budgetMatches(actual: number | null | undefined, expected: number) {
  return actual != null && Math.abs(Number(actual) - expected) < 0.005;
}

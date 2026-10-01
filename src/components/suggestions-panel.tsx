"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import type { Filters } from "@/hooks/use-filters";
import { api } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { RULE_METRICS, type Suggestion } from "@/services/rules/engine";
import type { ActionKind, ActionTarget } from "./action-modal";
import { ErrorBox, IaaCell, Mono } from "./common";
import { Button, Card } from "./ui";

interface Resp {
  rangeLabel: string;
  rangeKey: string;
  suggestions: Suggestion[];
  enabledRules: number;
  unevaluableCount: number;
  unevaluableReasons: string[];
}

const ACTION_LABEL = { DECREASE_BUDGET: "Decrease budget", INCREASE_BUDGET: "Increase budget", TURN_OFF: "Turn OFF", TURN_ON: "Turn ON" } as const;

/** Rule results are suggestions only. "Review & Confirm" opens the normal confirmation flow. */
export function SuggestionsPanel({
  filters,
  apiQuery,
  onReview,
}: {
  filters: Filters;
  apiQuery: URLSearchParams;
  onReview: (a: ActionKind, t: ActionTarget[], extra: { source: "RULE_SUGGESTION"; ruleId: string; initialPct?: number }) => void;
}) {
  const q = new URLSearchParams(apiQuery);
  q.set("status", "ALL");
  const { data, error, reload } = useApi<Resp>(filters.bcId ? `/api/rules/suggestions?${q}` : null);
  if (!filters.bcId) return null;
  if (error) return <ErrorBox error={error} onRetry={() => reload()} />;
  if (!data) return null;
  if (!data.enabledRules) {
    return (
      <p className="text-xs text-muted">
        No enabled rules. <Link className="underline" href="/rules">Create a rule</Link> to get suggested actions (rules never execute automatically).
      </p>
    );
  }
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Suggested actions — {data.rangeLabel} · {data.suggestions.length}
        </h2>
        {data.unevaluableCount > 0 && (
          <span className="text-[11px] text-muted" title={data.unevaluableReasons.join("; ")}>
            {data.unevaluableCount} campaign checks skipped: {data.unevaluableReasons.join("; ")}
          </span>
        )}
      </div>
      {!data.suggestions.length && <p className="text-xs text-muted">No campaign currently matches an enabled rule.</p>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {data.suggestions.slice(0, 30).map((s) => {
          const c = s.campaign;
          const action: ActionKind =
            s.action === "DECREASE_BUDGET" ? { kind: "budget", direction: "decrease" } : s.action === "INCREASE_BUDGET" ? { kind: "budget", direction: "increase" } : { kind: "status", action: s.action };
          return (
            <div key={`${s.ruleId}:${c.campaignId}`} className="rounded-md border border-warn/40 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-warn">
                <AlertTriangle className="size-3.5" /> Suggested Action · {s.ruleName}
              </div>
              <div className="mt-1 truncate font-medium" title={c.campaignName}>
                {c.campaignName}
              </div>
              <div className="text-[11px] text-muted">
                <Mono>{c.campaignId}</Mono> · {c.advertiserName}
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-2 text-xs tabular">
                <dt className="text-muted">IAA D0 ROAS</dt>
                <dd>
                  <IaaCell iaa={c.iaa} compact />
                </dd>
                <dt className="text-muted">Spend</dt>
                <dd>{money(c.metrics.spend, c.currency)}</dd>
                {s.matched
                  .filter((m) => m.metric !== "iaa_d0_roas" && m.metric !== "spend")
                  .map((m) => (
                    <div key={m.metric} className="contents">
                      <dt className="text-muted">{RULE_METRICS[m.metric].label}</dt>
                      <dd>{m.actual.toFixed(2)}</dd>
                    </div>
                  ))}
                <dt className="text-muted">Suggested</dt>
                <dd className="font-medium">
                  {ACTION_LABEL[s.action]}
                  {s.actionValue ? ` ${s.actionValue}%` : ""}
                </dd>
                {s.proposedBudget != null && (
                  <>
                    <dt className="text-muted">Budget</dt>
                    <dd>
                      {money(c.budget.amount, c.currency)} → <b>{money(s.proposedBudget, c.currency)}</b>
                    </dd>
                  </>
                )}
              </dl>
              <div className="mt-2 flex justify-end gap-1.5">
                <Button
                  size="sm"
                  onClick={async () => {
                    await api("/api/rules/suggestions", { method: "POST", json: { ruleId: s.ruleId, advertiserId: c.advertiserId, campaignId: c.campaignId, rangeKey: data.rangeKey } });
                    void reload();
                  }}
                >
                  DISMISS
                </Button>
                <Button size="sm" variant="primary" onClick={() => onReview(action, [c], { source: "RULE_SUGGESTION", ruleId: s.ruleId, initialPct: s.actionValue ?? undefined })}>
                  REVIEW &amp; CONFIRM
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

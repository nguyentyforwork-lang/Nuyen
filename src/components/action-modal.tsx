"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import type { Plan, PlanItem } from "@/services/tiktok/actions/engine";
import type { CampaignRow } from "@/types";
import { Mono } from "./common";
import { Button, cn, Input, Spinner } from "./ui";

export type ActionKind = { kind: "budget"; direction: "increase" | "decrease" } | { kind: "status"; action: "TURN_ON" | "TURN_OFF" };

export type ActionTarget = Pick<CampaignRow, "bcId" | "advertiserId" | "campaignId" | "campaignName" | "currency" | "budget" | "operationStatus">;

interface PrepareResponse {
  pendingId: string | null;
  plan: Plan;
  expiresAt: string | null;
}
interface ConfirmResult {
  results: Array<{ campaignId: string; advertiserId: string; status: string; message: string; verifiedValue: string | null }>;
}

type Phase = "configure" | "preparing" | "review" | "executing" | "done";

const PRESET_PCTS = [10, 20, 30];

export function ActionModal({
  open,
  onOpenChange,
  action,
  targets,
  source = "MANUAL",
  ruleId,
  initialPct,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  action: ActionKind | null;
  targets: ActionTarget[];
  source?: "MANUAL" | "RULE_SUGGESTION";
  ruleId?: string | null;
  initialPct?: number;
  onCompleted?: (affectedAdvertisers: string[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>("configure");
  const [mode, setMode] = useState<"percent" | "absolute">("percent");
  const [pct, setPct] = useState<number>(initialPct ?? 20);
  const [absolute, setAbsolute] = useState<string>("");
  const [prep, setPrep] = useState<PrepareResponse | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);

  const single = targets.length === 1 ? targets[0] : null;
  const isBudget = action?.kind === "budget";

  useEffect(() => {
    if (!open) return;
    // Reset the review flow each time the modal opens (fresh confirmation every time).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("configure");
    setPrep(null);
    setAck(false);
    setError(null);
    setResult(null);
    setMode("percent");
    setPct(initialPct ?? 20);
    setAbsolute(single?.budget.amount != null ? String(single.budget.amount) : "");
    // Status changes have nothing to configure: go straight to the review.
    if (action?.kind === "status") void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preview = useMemo(() => {
    if (!single || !isBudget || single.budget.amount == null) return null;
    const cur = single.budget.amount;
    const next = mode === "percent" ? Math.round(cur * (1 + ((action.direction === "increase" ? 1 : -1) * pct) / 100) * 100) / 100 : Number(absolute);
    return { cur, next, change: cur > 0 ? ((next - cur) / cur) * 100 : 0 };
  }, [single, isBudget, mode, pct, absolute, action]);

  async function prepare() {
    if (!action) return;
    setPhase("preparing");
    setError(null);
    try {
      const body =
        action.kind === "budget"
          ? {
              kind: "budget",
              direction: action.direction,
              change: mode === "percent" ? { type: "percent", value: pct } : { type: "absolute", value: Number(absolute) },
              targets: targets.map((t) => ({ bcId: t.bcId, advertiserId: t.advertiserId, campaignId: t.campaignId })),
              source,
              ruleId: ruleId ?? null,
            }
          : { kind: "status", action: action.action, targets: targets.map((t) => ({ bcId: t.bcId, advertiserId: t.advertiserId, campaignId: t.campaignId })), source, ruleId: ruleId ?? null };
      setPrep(await api<PrepareResponse>("/api/actions/prepare", { method: "POST", json: body }));
      setPhase("review");
    } catch (e) {
      setError(e as Error);
      setPhase(action.kind === "status" ? "review" : "configure");
    }
  }

  async function confirm() {
    if (!prep?.pendingId) return;
    setPhase("executing"); // disables the button immediately: no duplicate clicks
    setError(null);
    try {
      const r = await api<ConfirmResult>("/api/actions/confirm", { method: "POST", json: { pendingId: prep.pendingId, acknowledgeLimitOverride: ack } });
      setResult(r);
      setPhase("done");
      onCompleted?.([...new Set(targets.map((t) => t.advertiserId))]);
    } catch (e) {
      setError(e as Error);
      setPhase("done");
    }
  }

  async function cancel() {
    if (prep?.pendingId && phase === "review") {
      try {
        await api("/api/actions/cancel", { method: "POST", json: { pendingId: prep.pendingId } });
      } catch {
        /* the pending action also expires on its own */
      }
    }
    onOpenChange(false);
  }

  if (!action) return null;
  const failed = !!error || (result?.results.some((r) => r.status !== "SUCCESS") ?? false);
  const allOk = !!result && result.results.every((r) => r.status === "SUCCESS");
  const title =
    action.kind === "budget"
      ? `${action.direction === "increase" ? "Increase" : "Decrease"} budget${targets.length > 1 ? ` — ${targets.length} campaigns` : ""}`
      : `${action.action === "TURN_OFF" ? "Turn OFF" : "Turn ON"} campaign${targets.length > 1 ? `s (${targets.length})` : "?"}`;
  const confirmLabel =
    targets.length > 1 ? "CONFIRM BULK ACTION" : action.kind === "budget" ? "CONFIRM BUDGET CHANGE" : action.action === "TURN_OFF" ? "CONFIRM TURN OFF" : "CONFIRM TURN ON";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(o) : phase !== "executing" && cancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(920px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-xl"
          onEscapeKeyDown={(e) => phase === "executing" && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">Review and confirm a TikTok campaign change</Dialog.Description>
            <button className="rounded p-1 hover:bg-surface-2 disabled:opacity-30" disabled={phase === "executing"} onClick={cancel} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {phase === "configure" && action.kind === "budget" && (
              <div className="flex flex-col gap-3">
                {single && (
                  <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[13px]">
                    <dt className="text-muted">Campaign</dt>
                    <dd className="font-medium">{single.campaignName}</dd>
                    <dt className="text-muted">Campaign ID</dt>
                    <dd>
                      <Mono>{single.campaignId}</Mono>
                    </dd>
                    <dt className="text-muted">Ad Account</dt>
                    <dd>
                      <Mono>{single.advertiserId}</Mono>
                    </dd>
                    <dt className="text-muted">Current budget</dt>
                    <dd className="tabular">
                      {money(single.budget.amount, single.currency)}
                      {single.budget.label}
                    </dd>
                  </dl>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{action.direction === "increase" ? "Increase by" : "Decrease by"}</span>
                  {PRESET_PCTS.map((p) => (
                    <Button key={p} variant={mode === "percent" && pct === p ? "primary" : "outline"} size="sm" onClick={() => (setMode("percent"), setPct(p))}>
                      {action.direction === "increase" ? "+" : "-"}
                      {p}%
                    </Button>
                  ))}
                  <span className="text-muted">Custom</span>
                  <Input
                    className="w-20"
                    type="number"
                    min={1}
                    max={1000}
                    value={mode === "percent" ? pct : ""}
                    placeholder="%"
                    onChange={(e) => (setMode("percent"), setPct(Number(e.target.value)))}
                  />
                  <span className="text-muted">%</span>
                  {single && (
                    <>
                      <span className="ml-2 text-muted">or new budget</span>
                      <Input className="w-28" type="number" min={0} step="0.01" value={mode === "absolute" ? absolute : ""} placeholder={String(single.budget.amount ?? "")} onChange={(e) => (setMode("absolute"), setAbsolute(e.target.value))} />
                    </>
                  )}
                </div>
                {preview && (
                  <div className="grid grid-cols-3 gap-2 rounded-md bg-surface-2 p-3 tabular">
                    <div>
                      <div className="text-[11px] text-muted">Current</div>
                      <div className="text-base font-semibold">{money(preview.cur, single!.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted">New</div>
                      <div className="text-base font-semibold">{money(preview.next, single!.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted">Change</div>
                      <div className={cn("text-base font-semibold", Math.abs(preview.change) > 50 && "text-warn")}>
                        {preview.change > 0 ? "+" : ""}
                        {preview.change.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted">Nothing is changed yet. The next step reads live values from TikTok and shows the exact change for review.</p>
              </div>
            )}

            {phase === "preparing" && (
              <div className="flex items-center gap-2 py-8 text-muted">
                <Spinner /> Reading live campaign values from TikTok…
              </div>
            )}

            {(phase === "review" || phase === "executing" || phase === "done") && prep && <ReviewTable plan={prep.plan} result={result} />}

            {phase === "review" && prep && action.kind === "status" && action.action === "TURN_OFF" && prep.plan.executableCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-warn/40 px-3 py-2 text-warn">
                <AlertTriangle className="size-4" /> This will stop campaign delivery.
              </div>
            )}

            {phase === "review" && prep?.plan.requiresLimitOverride && (
              <label className="mt-3 flex items-start gap-2 rounded-md border border-danger/50 px-3 py-2 text-danger">
                <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  <b>Safety limit exceeded.</b> At least one change is beyond the single-change limit (+{prep.plan.limits.maxIncreasePct}% / -{prep.plan.limits.maxDecreasePct}%). I have reviewed it and want to proceed anyway.
                </span>
              </label>
            )}

            {phase === "review" && prep && !prep.pendingId && (
              <div className="mt-3 rounded-md border border-border px-3 py-2 text-muted">No campaign in this selection can be changed. See the blockers above. Nothing will be executed.</div>
            )}

            {error && (
              <div className="mt-3 rounded-md border border-danger/40 px-3 py-2 text-danger">
                <div className="font-medium">{phase === "done" ? "Action failed" : "Could not prepare the action"}</div>
                <div className="text-xs">Reason: {error instanceof ApiError && error.isRateLimit ? "TikTok API/MCP rate limit reached. Please retry later." : error.message}</div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <div className="text-xs text-muted">
              {prep && phase !== "configure" && (
                <>
                  Total campaigns affected: <b className="text-fg">{prep.plan.executableCount}</b>
                  {prep.plan.items.length !== prep.plan.executableCount && ` (of ${prep.plan.items.length} selected)`}
                  {prep.expiresAt && phase === "review" && <> · confirmation expires {new Date(prep.expiresAt).toLocaleTimeString()}</>}
                </>
              )}
            </div>
            <div className="flex gap-2">
              {phase !== "done" && (
                <Button variant="outline" onClick={cancel} disabled={phase === "executing"}>
                  CANCEL
                </Button>
              )}
              {phase === "configure" && (
                <Button variant="primary" onClick={prepare} disabled={mode === "percent" ? !(pct > 0) : !(Number(absolute) > 0)}>
                  Review change
                </Button>
              )}
              {phase === "review" && (
                <Button
                  variant={action.kind === "status" && action.action === "TURN_OFF" ? "danger" : "primary"}
                  onClick={confirm}
                  disabled={!prep?.pendingId || (prep.plan.requiresLimitOverride && !ack)}
                >
                  {confirmLabel}
                </Button>
              )}
              {phase === "executing" && (
                <Button variant="primary" disabled>
                  <Spinner className="border-accent-fg border-t-transparent" /> Executing...
                </Button>
              )}
              {phase === "done" && allOk && (
                <Button variant="success" onClick={() => onOpenChange(false)}>
                  <CheckCircle2 className="size-4" /> Completed
                </Button>
              )}
              {phase === "done" && failed && (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                  <Button variant="danger" onClick={() => (setResult(null), setPrep(null), setAck(false), setError(null), action.kind === "status" ? void prepare() : setPhase("configure"))}>
                    <XCircle className="size-4" /> Failed — Retry
                  </Button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReviewTable({ plan, result }: { plan: Plan; result: ConfirmResult | null }) {
  const byId = new Map(result?.results.map((r) => [`${r.advertiserId}:${r.campaignId}`, r]));
  const isBudget = plan.kind === "BUDGET";
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="text-[11px] uppercase tracking-wide text-muted">
        <tr className="border-b border-border">
          <th className="py-1.5 pr-2">Campaign</th>
          <th className="py-1.5 pr-2">Ad Account</th>
          <th className="py-1.5 pr-2">Current</th>
          <th className="py-1.5 pr-2">Proposed</th>
          {isBudget && <th className="py-1.5 pr-2">Change</th>}
          <th className="py-1.5">{result ? "Result" : "Impact / checks"}</th>
        </tr>
      </thead>
      <tbody>
        {plan.items.map((i) => {
          const r = byId.get(`${i.advertiserId}:${i.campaignId}`);
          return (
            <tr key={`${i.advertiserId}:${i.campaignId}`} className={cn("border-b border-border align-top", i.blockers.length && "opacity-60")}>
              <td className="py-1.5 pr-2">
                <div className="font-medium">{i.campaignName}</div>
                <Mono className="text-muted">{i.campaignId}</Mono>
                {i.automationType !== "MANUAL" && <div className="text-[11px] text-muted">{i.automationType}</div>}
              </td>
              <td className="py-1.5 pr-2">
                <Mono>{i.advertiserId}</Mono>
              </td>
              <td className="py-1.5 pr-2 tabular">{isBudget ? money(i.current.budget, i.currency) : i.current.operationStatus === "ENABLE" ? "ACTIVE (ENABLE)" : i.current.operationStatus === "DISABLE" ? "PAUSED (DISABLE)" : i.current.operationStatus}</td>
              <td className="py-1.5 pr-2 font-medium tabular">
                {isBudget ? money(i.proposed.budget ?? null, i.currency) : i.proposed.operationStatus === "ENABLE" ? "ACTIVE (ENABLE)" : "PAUSED (DISABLE)"}
              </td>
              {isBudget && (
                <td className={cn("py-1.5 pr-2 tabular", i.exceedsLimit && "font-semibold text-danger")}>
                  {i.changePct == null ? "—" : `${i.changePct > 0 ? "+" : ""}${i.changePct}%`}
                </td>
              )}
              <td className="py-1.5 text-xs">
                {r ? <ResultLine r={r} /> : <ItemChecks i={i} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ItemChecks({ i }: { i: PlanItem }) {
  return (
    <div className="flex flex-col gap-0.5">
      {!i.blockers.length && <span>{i.impact}</span>}
      {i.blockers.map((b) => (
        <span key={b} className="text-danger">
          ✕ {b}
        </span>
      ))}
      {i.warnings.map((w) => (
        <span key={w} className="text-warn">
          ⚠ {w}
        </span>
      ))}
      <span className="text-muted">via {i.tool}</span>
    </div>
  );
}

function ResultLine({ r }: { r: ConfirmResult["results"][number] }) {
  const ok = r.status === "SUCCESS";
  return (
    <span className={ok ? "text-ok" : r.status === "SKIPPED" ? "text-muted" : "text-danger"}>
      <b>{r.status}</b> — {r.message}
    </span>
  );
}

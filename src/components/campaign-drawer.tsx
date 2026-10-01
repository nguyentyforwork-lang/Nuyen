"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Pause, Play, Plus, X } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/hooks/use-api";
import { dateTime, int, money } from "@/lib/client/format";
import type { CampaignRow, DataNotice } from "@/types";
import type { ActionKind, ActionTarget } from "./action-modal";
import { ErrorBox, IaaCell, Mono, Notices, StatusBadge } from "./common";
import { Button, Card, Spinner } from "./ui";

interface Detail {
  rangeLabel: string;
  seriesRange: { start: string; end: string };
  row: CampaignRow;
  series: Array<{ day: string; spend: number; roasPct: number | null; conversions: number; installs: number }>;
  history: Array<{ id: string; createdAt: string; operator: string; actionType: string; beforeValue: string; afterValue: string; verifiedValue: string | null; status: string; errorMessage: string | null }>;
  historyError: string | null;
  notices: DataNotice[];
}

const axis = { stroke: "var(--chart-axis)", fontSize: 11, tickLine: false, axisLine: { stroke: "var(--chart-grid)" } } as const;

export function CampaignDrawer({
  target,
  query,
  onClose,
  onAction,
}: {
  target: { advertiserId: string; campaignId: string } | null;
  query: string;
  onClose: () => void;
  onAction: (a: ActionKind, t: ActionTarget[]) => void;
}) {
  const path = target ? `/api/campaigns/${target.advertiserId}/${target.campaignId}?${query}` : null;
  const { data, error, loading, reload } = useApi<Detail>(path);
  const [creativeLimit, setCreativeLimit] = useState(10);
  const r = data?.row;
  const hasRoas = data?.series.some((s) => s.roasPct != null);

  return (
    <Dialog.Root open={!!target} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/20" />
        <Dialog.Content className="fixed right-0 top-0 z-30 flex h-full w-[min(760px,100vw)] flex-col border-l border-border bg-surface shadow-xl">
          <div className="flex items-start justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold">{r?.campaignName ?? "Campaign"}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">
                {r ? (
                  <>
                    Campaign <Mono>{r.campaignId}</Mono> · Account <Mono>{r.advertiserId}</Mono> · {data?.rangeLabel}
                  </>
                ) : (
                  "Loading…"
                )}
              </Dialog.Description>
            </div>
            <button className="rounded p-1 hover:bg-surface-2" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {loading && !data && (
              <div className="flex items-center gap-2 text-muted">
                <Spinner /> Loading campaign detail from TikTok…
              </div>
            )}
            <ErrorBox error={error} onRetry={() => reload()} />
            {r && data && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Status">
                    <StatusBadge secondaryStatus={r.secondaryStatus} operationStatus={r.operationStatus} />
                  </Stat>
                  <Stat label="Budget">
                    {r.budget.amount != null ? `${money(r.budget.amount, r.currency)}${r.budget.label}` : r.budget.label}
                  </Stat>
                  <Stat label={`Spend — ${data.rangeLabel}`}>{money(r.metrics.spend, r.currency)}</Stat>
                  <Stat label={`IAA D0 ROAS — ${data.rangeLabel}`}>
                    <IaaCell iaa={r.iaa} compact />
                  </Stat>
                  <Stat label="Installs / CPI">
                    {int(r.metrics.installs)} / {r.metrics.installs ? money(r.metrics.cpi, r.currency) : "N/A"}
                  </Stat>
                  <Stat label="Conversions / CPA">
                    {int(r.metrics.conversions)} / {r.metrics.conversions ? money(r.metrics.costPerConversion, r.currency) : "N/A"}
                  </Stat>
                  <Stat label="App">{r.appName ?? (r.appId ? r.appId : "N/A")}</Stat>
                  <Stat label="Type">{r.automationType}</Stat>
                </div>
                {!r.iaa.roasPct.ok && <p className="text-xs text-muted">IAA D0 ROAS: {r.iaa.roasPct.reason}</p>}

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!r.writeSupport.budget.ok} title={r.writeSupport.budget.ok ? "" : r.writeSupport.budget.reason} onClick={() => onAction({ kind: "budget", direction: "increase" }, [r])}>
                      <Plus className="size-3.5" /> Increase Budget
                    </Button>
                    <Button disabled={!r.writeSupport.budget.ok} title={r.writeSupport.budget.ok ? "" : r.writeSupport.budget.reason} onClick={() => onAction({ kind: "budget", direction: "decrease" }, [r])}>
                      <Minus className="size-3.5" /> Decrease Budget
                    </Button>
                    {r.operationStatus === "ENABLE" && (
                      <Button disabled={!r.writeSupport.status.ok} onClick={() => onAction({ kind: "status", action: "TURN_OFF" }, [r])}>
                        <Pause className="size-3.5" /> Turn OFF
                      </Button>
                    )}
                    {r.operationStatus === "DISABLE" && (
                      <Button disabled={!r.writeSupport.status.ok} onClick={() => onAction({ kind: "status", action: "TURN_ON" }, [r])}>
                        <Play className="size-3.5" /> Turn ON
                      </Button>
                    )}
                  </div>
                  {!r.writeSupport.budget.ok && <p className="mt-1 text-xs text-muted">Budget: {r.writeSupport.budget.reason}</p>}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Spend per day — {data.seriesRange.start} to {data.seriesRange.end}
                  </h3>
                  <Card className="h-44 p-2">
                    <ResponsiveContainer>
                      <BarChart data={data.series} barCategoryGap={2}>
                        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                        <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis {...axis} width={56} tickFormatter={(v: number) => money(v, r.currency, { compact: true })} />
                        <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} formatter={(v) => [money(Number(v), r.currency), "Spend"]} />
                        <Bar dataKey="spend" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">IAA D0 ROAS per day</h3>
                  {hasRoas ? (
                    <Card className="h-40 p-2">
                      <ResponsiveContainer>
                        <LineChart data={data.series}>
                          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                          <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis {...axis} width={44} tickFormatter={(v: number) => `${v}%`} />
                          <ReferenceLine y={100} stroke="var(--chart-axis)" strokeDasharray="3 3" />
                          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} formatter={(v) => [v == null ? "N/A" : `${Number(v).toFixed(1)}%`, "IAA D0 ROAS"]} />
                          <Line dataKey="roasPct" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                  ) : (
                    <p className="text-xs text-muted">{r.iaa.roasPct.ok ? "No daily ROAS values in range." : r.iaa.roasPct.reason}</p>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Geo breakdown — {data.rangeLabel}</h3>
                  <SmallTable
                    head={["Country", "Spend", "Share", "Installs", "Conversions", "IAA D0 ROAS"]}
                    rows={r.geos.slice(0, 15).map((g) => [
                      g.countryCode === "None" ? "Unknown" : g.countryCode,
                      money(g.spend, r.currency),
                      r.metrics.spend ? `${((g.spend / r.metrics.spend) * 100).toFixed(1)}%` : "—",
                      int(g.installs),
                      int(g.conversions),
                      <IaaCell key="i" iaa={g.iaa} compact />,
                    ])}
                    empty="No geo delivery in range."
                  />
                </section>

                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Creatives — {data.rangeLabel}</h3>
                  <p className="mb-2 text-xs text-muted">
                    Top creative: {r.topCreative.creative ? <b className="text-fg">{r.topCreative.creative.adName || r.topCreative.creative.adId}</b> : "none"} · {r.topCreative.basis}
                  </p>
                  <SmallTable
                    head={["Creative (ad)", "Creative ID", "Spend", "Installs", "Conversions", "IAA D0 ROAS"]}
                    rows={r.creatives.slice(0, creativeLimit).map((c) => [
                      <span key="n" className={c.adId === r.topCreative.creative?.adId ? "font-semibold" : ""} title={c.adName ?? ""}>
                        {(c.adName || c.adId).slice(0, 60)}
                        {c.spend < r.topCreative.threshold && <span className="ml-1 text-[11px] text-muted">(below threshold)</span>}
                      </span>,
                      <Mono key="id">{c.adId}</Mono>,
                      money(c.spend, r.currency),
                      int(c.installs),
                      int(c.conversions),
                      <IaaCell key="i" iaa={c.iaa} compact />,
                    ])}
                    empty="No creative delivery in range."
                  />
                  {r.creatives.length > creativeLimit && (
                    <button className="mt-1 text-xs underline" onClick={() => setCreativeLimit((n) => n + 20)}>
                      Show more ({r.creatives.length - creativeLimit} more)
                    </button>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent action history</h3>
                  {data.historyError ? (
                    <p className="text-xs text-danger">{data.historyError}</p>
                  ) : (
                    <SmallTable
                      head={["When", "User", "Action", "Before → After", "Status"]}
                      rows={data.history.map((h) => [
                        dateTime(h.createdAt),
                        h.operator,
                        h.actionType,
                        `${h.beforeValue} → ${h.afterValue}${h.verifiedValue && h.verifiedValue !== h.afterValue ? ` (TikTok: ${h.verifiedValue})` : ""}`,
                        <span key="s" className={h.status === "SUCCESS" ? "text-ok" : "text-danger"} title={h.errorMessage ?? ""}>
                          {h.status}
                        </span>,
                      ])}
                      empty="No actions recorded for this campaign."
                    />
                  )}
                </section>
                <Notices notices={data.notices.filter((n) => n.level !== "info")} />
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 truncate font-medium tabular">{children}</div>
    </Card>
  );
}

export function SmallTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 tabular">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

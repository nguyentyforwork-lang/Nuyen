"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorBox, IaaCell, Mono, Notices, StatusBadge } from "@/components/common";
import { FilterBar } from "@/components/filter-bar";
import { Badge, Card, Empty } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useFilters } from "@/hooks/use-filters";
import { money, moneyByCurrency, pct } from "@/lib/client/format";
import type { AccountSummary } from "@/services/dashboard/views";
import type { AppRow, CampaignRow, DataNotice, Maybe, MoneyByCurrency } from "@/types";

interface Resp {
  rangeLabel: string;
  notices: DataNotice[];
  lastUpdated: string;
  summary: { bcId: string; adAccounts: number; activeAccounts: number; apps: number; runningApps: number; activeCampaigns: number; spend: MoneyByCurrency; roas: Maybe<number> };
  tree: Array<{ account: AccountSummary; apps: Array<{ app: AppRow | null; campaigns: CampaignRow[] }> }>;
}

/** BC overview → ad accounts → apps → campaigns. */
export default function BusinessCentersPage() {
  const { filters, set, apiQuery } = useFilters();
  const { data, error, loading, reload } = useApi<Resp>(filters.bcId ? `/api/business-centers/${filters.bcId}/overview?${apiQuery}` : null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlyRunning, setOnlyRunning] = useState(true);
  const carry = new URLSearchParams(apiQuery);
  carry.delete("advertiserId");

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} set={set} show={{ account: false, app: false, status: false, search: false, runningApps: false }} rangeLabel={data?.rangeLabel} lastUpdated={data?.lastUpdated} loading={loading} onRefresh={() => reload(true)} />
      {!filters.bcId && (
        <Card>
          <Empty>Select a Business Center ID.</Empty>
        </Card>
      )}
      <ErrorBox error={error} onRetry={() => reload()} />
      {data && (
        <>
          <Notices notices={data.notices} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            {[
              ["BC ID", <Mono key="b">{data.summary.bcId}</Mono>],
              ["Ad accounts", data.summary.adAccounts],
              ["Active accounts", data.summary.activeAccounts],
              ["Apps", `${data.summary.apps} (${data.summary.runningApps} running)`],
              ["Active campaigns", data.summary.activeCampaigns],
              [`Spend — ${data.rangeLabel}`, moneyByCurrency(data.summary.spend)],
              [`IAA D0 ROAS — ${data.rangeLabel}`, pct(data.summary.roas)],
            ].map(([l, v]) => (
              <Card key={String(l)} className="px-3 py-2">
                <div className="text-[11px] text-muted">{l}</div>
                <div className="mt-0.5 truncate font-semibold tabular">{v}</div>
              </Card>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> Show running apps / active campaigns only
          </label>
          <div className="flex flex-col gap-2">
            {data.tree.map(({ account: a, apps }) => {
              const visibleApps = apps
                .map((x) => ({ ...x, campaigns: onlyRunning ? x.campaigns.filter((c) => c.statusBucket === "ACTIVE") : x.campaigns }))
                .filter((x) => !onlyRunning || x.campaigns.length);
              const isOpen = open[a.advertiserId] ?? a.activeCampaigns > 0;
              return (
                <Card key={a.advertiserId}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => setOpen((o) => ({ ...o, [a.advertiserId]: !isOpen }))}>
                    {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span className="font-medium">{a.name}</span>
                    <Mono className="text-muted">{a.advertiserId}</Mono>
                    <Badge className={a.status === "STATUS_ENABLE" ? "border-ok/30 text-ok" : "border-warn/40 text-warn"}>{a.status?.replace("STATUS_", "") ?? "UNKNOWN"}</Badge>
                    <span className="ml-auto text-xs text-muted tabular">
                      {a.runningApps} running apps · {a.activeCampaigns} active campaigns · {money(a.spend, a.currency)}
                    </span>
                    <Link className="text-xs underline" href={`/accounts/${a.advertiserId}?${carry}`} onClick={(e) => e.stopPropagation()}>
                      open
                    </Link>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border px-3 py-2">
                      {!visibleApps.length && <p className="text-xs text-muted">No {onlyRunning ? "running apps / active campaigns" : "campaigns"}.</p>}
                      {visibleApps.map(({ app, campaigns }) => (
                        <div key={app?.appId ?? "none"} className="mb-2">
                          <div className="flex items-center gap-2 text-[13px]">
                            <span className="font-medium">{app ? app.appName : "Non-app campaigns"}</span>
                            {app && <Mono className="text-muted">{app.appId}</Mono>}
                            {app?.running && <Badge className="border-ok/30 text-ok">Running</Badge>}
                            {app && (
                              <span className="text-xs text-muted tabular">
                                {money(app.spend, app.currency)} · ROAS <IaaCell iaa={app.iaa} compact />
                              </span>
                            )}
                          </div>
                          <ul className="ml-4 mt-1 border-l border-border pl-3">
                            {campaigns.map((c) => (
                              <li key={c.campaignId} className="flex items-center gap-2 py-0.5 text-xs">
                                <StatusBadge secondaryStatus={c.secondaryStatus} operationStatus={c.operationStatus} />
                                <span className="truncate">{c.campaignName}</span>
                                <Mono className="text-muted">{c.campaignId}</Mono>
                                <span className="ml-auto tabular">{money(c.metrics.spend, c.currency)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

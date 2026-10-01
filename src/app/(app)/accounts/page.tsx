"use client";

import Link from "next/link";
import { ErrorBox, IaaCell, Mono, Notices } from "@/components/common";
import { FilterBar } from "@/components/filter-bar";
import { Badge, Card, Empty } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useFilters } from "@/hooks/use-filters";
import { money } from "@/lib/client/format";
import type { AccountSummary } from "@/services/dashboard/views";
import type { DataNotice } from "@/types";

interface Resp {
  rangeLabel: string;
  items: AccountSummary[];
  total: number;
  notices: DataNotice[];
  lastUpdated: string;
}

export default function AccountsPage() {
  const { filters, set, apiQuery } = useFilters({ pageSize: "500" });
  const { data, error, loading, reload } = useApi<Resp>(filters.bcId ? `/api/accounts?${apiQuery}` : null);
  const carry = new URLSearchParams(apiQuery);
  carry.delete("advertiserId");
  carry.delete("page");
  carry.delete("pageSize");

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} set={set} show={{ account: false, app: false, status: false, runningApps: false, minCreativeSpend: false }} rangeLabel={data?.rangeLabel} lastUpdated={data?.lastUpdated} loading={loading} onRefresh={() => reload(true)} />
      {!filters.bcId && (
        <Card>
          <Empty>Select a Business Center to list its ad accounts.</Empty>
        </Card>
      )}
      <ErrorBox error={error} onRetry={() => reload()} />
      {data && (
        <>
          <Notices notices={data.notices} />
          <div className="max-h-[calc(100vh-240px)] overflow-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  {["BC ID", "Ad Account ID", "Ad Account Name", "Currency", "Status", "Number of Apps", "Active Campaigns", `Spend — ${data.rangeLabel}`, `IAA D0 ROAS — ${data.rangeLabel}`].map((h) => (
                    <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.advertiserId} className="hover:bg-surface-2">
                    <td className="border-b border-border px-2.5 py-1.5">
                      <Mono className="text-muted">{a.bcId}</Mono>
                    </td>
                    <td className="border-b border-border px-2.5 py-1.5">
                      <Mono>{a.advertiserId}</Mono>
                    </td>
                    <td className="border-b border-border px-2.5 py-1.5 font-medium">
                      <Link className="hover:underline" href={`/accounts/${a.advertiserId}?${carry}`}>
                        {a.name}
                      </Link>
                    </td>
                    <td className="border-b border-border px-2.5 py-1.5">{a.currency ?? "N/A"}</td>
                    <td className="border-b border-border px-2.5 py-1.5">
                      <Badge className={a.status === "STATUS_ENABLE" ? "border-ok/30 text-ok" : "border-warn/40 text-warn"}>{a.status?.replace("STATUS_", "") ?? "UNKNOWN"}</Badge>
                    </td>
                    <td className="border-b border-border px-2.5 py-1.5 tabular">
                      {a.apps} <span className="text-muted">({a.runningApps} running)</span>
                    </td>
                    <td className="border-b border-border px-2.5 py-1.5 tabular">
                      {a.activeCampaigns} <span className="text-muted">/ {a.totalCampaigns}</span>
                    </td>
                    <td className="border-b border-border px-2.5 py-1.5 font-medium tabular">{money(a.spend, a.currency)}</td>
                    <td className="border-b border-border px-2.5 py-1.5">
                      <IaaCell iaa={{ roasPct: a.iaaRoas, revenue: { ok: false, reason: "" }, source: "unavailable" }} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && <Empty>No ad accounts found.</Empty>}
          </div>
        </>
      )}
    </div>
  );
}

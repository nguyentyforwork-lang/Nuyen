"use client";

import { useState } from "react";
import { ErrorBox, Mono } from "@/components/common";
import { FilterBar } from "@/components/filter-bar";
import { Button, Card, Empty, Field, Input, Select } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useFilters } from "@/hooks/use-filters";
import { int, money } from "@/lib/client/format";

interface Row {
  advertiserId: string;
  advertiserName: string;
  currency: string | null;
  id: string;
  name: string | null;
  campaignId: string | null;
  campaignName: string | null;
  countryCode: string | null;
  day: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpi: number;
  installs: number;
  conversions: number;
  costPerConversion: number;
  iaaRevenue: number | null;
  iaaRoasPct: number | null;
}
type Col = readonly [string, (r: Row) => React.ReactNode, (r: Row) => unknown];

interface Resp {
  rangeLabel: string;
  items: Row[];
  total: number;
  page: number;
  totalPages: number;
  metricsAvailable: Record<string, boolean>;
  iaa: { kind: string; reason?: string };
  errors: Array<{ advertiserId: string; message: string }>;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Detailed reporting. Only metrics verified on the TikTok MCP report tool are shown. */
export default function ReportingPage() {
  const { filters, set, apiQuery } = useFilters({ status: "ALL" });
  const [level, setLevel] = useState("campaign");
  const [breakdown, setBreakdown] = useState("none");
  const [geo, setGeo] = useState("");
  const [campaignIds, setCampaignIds] = useState("");
  const [adIds, setAdIds] = useState("");
  const q = new URLSearchParams(apiQuery);
  q.set("level", level);
  q.set("breakdown", breakdown);
  if (geo) q.set("geo", geo.toUpperCase().replace(/\s/g, ""));
  if (campaignIds) q.set("campaignIds", campaignIds.replace(/\s/g, ""));
  if (adIds) q.set("adIds", adIds.replace(/\s/g, ""));
  const { data, error, loading, reload } = useApi<Resp>(filters.bcId ? `/api/reports?${q}` : null);
  const m = data?.metricsAvailable ?? {};

  const cols: Col[] = [
    ["Ad Account", (r) => <Mono>{r.advertiserId}</Mono>, (r) => r.advertiserId],
    [level === "campaign" ? "Campaign" : level === "adgroup" ? "Ad group" : "Creative (ad)", (r) => <span title={r.id}>{r.name ?? r.id}</span>, (r) => r.name ?? r.id],
    ["ID", (r) => <Mono>{r.id}</Mono>, (r) => r.id],
    ...(level !== "campaign" ? ([["Campaign", (r: Row) => r.campaignName ?? r.campaignId ?? "—", (r: Row) => r.campaignName ?? r.campaignId]] as Col[]) : []),
    ...(breakdown === "country" || geo ? ([["Geo", (r: Row) => r.countryCode ?? "—", (r: Row) => r.countryCode]] as Col[]) : []),
    ...(breakdown === "day" ? ([["Day", (r: Row) => r.day ?? "—", (r: Row) => r.day]] as Col[]) : []),
    ["Spend", (r) => money(r.spend, r.currency), (r) => r.spend],
    ["Impressions", (r) => int(r.impressions), (r) => r.impressions],
    ["Clicks", (r) => int(r.clicks), (r) => r.clicks],
    ["CTR", (r) => `${r.ctr.toFixed(2)}%`, (r) => r.ctr],
    ["Installs", (r) => int(r.installs), (r) => r.installs],
    ["CPI", (r) => (r.installs ? money(r.cpi, r.currency) : "N/A"), (r) => r.cpi],
    ["Conversions", (r) => int(r.conversions), (r) => r.conversions],
    ["CPA", (r) => (r.conversions ? money(r.costPerConversion, r.currency) : "N/A"), (r) => r.costPerConversion],
    ...(m.iaaRevenue ? ([["IAA Revenue (D0)", (r: Row) => money(r.iaaRevenue, r.currency), (r: Row) => r.iaaRevenue]] as Col[]) : []),
    ...(m.iaaRoas ? ([["IAA D0 ROAS", (r: Row) => (r.iaaRoasPct == null ? "N/A" : `${r.iaaRoasPct.toFixed(1)}%`), (r: Row) => r.iaaRoasPct]] as Col[]) : []),
  ];

  function download(format: "csv") {
    if (!data) return;
    const lines = [[`Report — ${data.rangeLabel}`], cols.map((c) => c[0]), ...data.items.map((r) => cols.map((c) => c[2](r)))];
    const blob = new Blob(["﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n")], { type: `text/${format}` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_${filters.bcId}_${level}_${breakdown}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} set={set} show={{ status: false, search: false, runningApps: false, minCreativeSpend: false }} rangeLabel={data?.rangeLabel} loading={loading} onRefresh={() => reload(true)} />
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <Field label="Level">
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="campaign">Campaign</option>
            <option value="adgroup">Ad group</option>
            <option value="ad">Creative (ad)</option>
          </Select>
        </Field>
        <Field label="Breakdown">
          <Select value={breakdown} onChange={(e) => setBreakdown(e.target.value)}>
            <option value="none">None</option>
            <option value="country">Geo (country)</option>
            <option value="day">Day (≤30 days)</option>
          </Select>
        </Field>
        <Field label="Geo filter">
          <Input className="w-28" placeholder="US,BR" value={geo} onChange={(e) => setGeo(e.target.value)} />
        </Field>
        <Field label="Campaign IDs">
          <Input className="w-56" placeholder="comma separated" value={campaignIds} onChange={(e) => setCampaignIds(e.target.value)} />
        </Field>
        <Field label="Creative (ad) IDs">
          <Input className="w-56" placeholder="comma separated" value={adIds} onChange={(e) => setAdIds(e.target.value)} />
        </Field>
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={!data?.items.length} onClick={() => download("csv")} title="Exports the rows on this page">
            CSV (page)
          </Button>
          <a className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs hover:bg-surface-2" href={`/api/export?${new URLSearchParams({ ...Object.fromEntries(apiQuery), type: "current_view", format: "xlsx" })}`}>
            XLSX (campaign view)
          </a>
        </div>
      </Card>
      {!filters.bcId && (
        <Card>
          <Empty>Select a Business Center (and ideally an ad account) to run a report.</Empty>
        </Card>
      )}
      <ErrorBox error={error} onRetry={() => reload()} />
      {data && (
        <>
          {data.iaa.kind === "unavailable" && <p className="text-xs text-warn">IAA metrics hidden: {data.iaa.reason}</p>}
          {data.errors.map((e) => (
            <p key={e.advertiserId} className="text-xs text-danger">
              Account {e.advertiserId}: {e.message}
            </p>
          ))}
          <div className="max-h-[calc(100vh-320px)] overflow-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c[0]} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      {c[0]}
                      {["Spend", "IAA D0 ROAS", "IAA Revenue (D0)"].includes(c[0]) ? ` — ${data.rangeLabel}` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((r, i) => (
                  <tr key={i} className="hover:bg-surface-2">
                    {cols.map((c) => (
                      <td key={c[0]} className="max-w-72 truncate border-b border-border px-2.5 py-1.5 tabular">
                        {c[1](r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && <Empty>No delivery for this selection.</Empty>}
          </div>
          <div className="flex justify-end gap-1 text-xs text-muted">
            <span className="mr-2 self-center">
              {data.total} rows · page {data.page} of {data.totalPages}
            </span>
            <Button size="sm" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) }, { resetPage: false })}>
              Prev
            </Button>
            <Button size="sm" disabled={data.page >= data.totalPages} onClick={() => set({ page: String(data.page + 1) }, { resetPage: false })}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

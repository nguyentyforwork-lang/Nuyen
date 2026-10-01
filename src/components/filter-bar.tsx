"use client";

import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Filters } from "@/hooks/use-filters";
import { useApi } from "@/hooks/use-api";
import { time } from "@/lib/client/format";
import type { AdAccount, BusinessCenter } from "@/types";
import { Button, Field, Input, Select, Spinner } from "./ui";

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last_3", "Last 3 days"],
  ["last_7", "Last 7 days"],
  ["last_14", "Last 14 days"],
  ["last_30", "Last 30 days"],
  ["custom", "Custom range"],
] as const;

const STATUSES = [
  ["ALL", "All"],
  ["ACTIVE", "Active"],
  ["PAUSED", "Paused"],
  ["NOT_DELIVERING", "Not delivering"],
  ["PENDING", "Pending"],
  ["DELETED", "Deleted"],
] as const;

export interface FilterBarProps {
  filters: Filters;
  set: (p: Partial<Filters>) => void;
  show?: { account?: boolean; app?: boolean; status?: boolean; search?: boolean; runningApps?: boolean; minCreativeSpend?: boolean };
  appOptions?: Array<{ appId: string; name: string }>;
  rangeLabel?: string;
  lastUpdated?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
}

export function FilterBar({ filters, set, show = {}, appOptions, rangeLabel, lastUpdated, loading, onRefresh }: FilterBarProps) {
  const s = { account: true, app: true, status: true, search: true, runningApps: true, minCreativeSpend: true, ...show };
  const bcs = useApi<{ items: BusinessCenter[] }>("/api/business-centers");
  const accounts = useApi<{ items: AdAccount[] }>(filters.bcId ? `/api/business-centers/${filters.bcId}/accounts` : null);
  const [q, setQ] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    // URL changed from elsewhere (back button, link): adopt it.
    setSyncedQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    const t = setTimeout(() => q !== filters.q && set({ q }), 350);
    return () => clearTimeout(t);
  }, [q, filters.q, set]);

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Business Center">
          <Select className="w-64" value={filters.bcId} onChange={(e) => set({ bcId: e.target.value, advertiserId: "", appId: "" })}>
            <option value="">{bcs.loading ? "Loading…" : "Select a Business Center"}</option>
            {bcs.data?.items.map((b) => (
              <option key={b.bcId} value={b.bcId}>
                {b.name} · {b.bcId}
                {b.status !== "ENABLE" ? ` (${b.status})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        {s.account && (
          <Field label="Ad Account">
            <Select className="w-56" value={filters.advertiserId} disabled={!filters.bcId} onChange={(e) => set({ advertiserId: e.target.value, appId: "" })}>
              <option value="">{accounts.loading ? "Loading…" : `All accounts${accounts.data ? ` (${accounts.data.items.length})` : ""}`}</option>
              {accounts.data?.items.map((a) => (
                <option key={a.advertiserId} value={a.advertiserId}>
                  {a.name} · {a.advertiserId}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {s.app && (
          <Field label="App">
            <Select className="w-48" value={filters.appId} disabled={!filters.bcId} onChange={(e) => set({ appId: e.target.value })}>
              <option value="">All apps</option>
              {appOptions?.map((a) => (
                <option key={a.appId} value={a.appId}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {s.status && (
          <Field label="Campaign Status">
            <Select value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Date Range">
          <Select value={filters.preset} onChange={(e) => set({ preset: e.target.value })}>
            {PRESETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {filters.preset === "custom" && (
          <>
            <Field label="From">
              <Input type="date" value={filters.start} onChange={(e) => set({ start: e.target.value })} />
            </Field>
            <Field label="To">
              <Input type="date" value={filters.end} onChange={(e) => set({ end: e.target.value })} />
            </Field>
          </>
        )}
        {s.search && (
          <Field label="Search" className="min-w-56 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
              <Input className="w-full pl-7" placeholder="BC / account / app / campaign / creative name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </Field>
        )}
        {s.runningApps && (
          <label className="flex h-8 items-center gap-1.5 text-xs">
            <input type="checkbox" checked={filters.runningApps === "1"} onChange={(e) => set({ runningApps: e.target.checked ? "1" : "" })} />
            Running apps only
          </label>
        )}
        {s.minCreativeSpend && (
          <Field label="Top creative min spend">
            <Input
              className="w-24"
              type="number"
              min={0}
              step={1}
              placeholder="20"
              value={filters.minCreativeSpend}
              onChange={(e) => set({ minCreativeSpend: e.target.value })}
              title="Minimum spend before a creative can be called 'Top Creative'"
            />
          </Field>
        )}
        <div className="ml-auto flex items-center gap-2 pb-0.5">
          <div className="text-right text-[11px] leading-tight text-muted">
            {rangeLabel && <div className="font-medium text-fg">{rangeLabel}</div>}
            <div>Last updated: {loading ? "…" : time(lastUpdated)}</div>
          </div>
          {onRefresh && (
            <Button onClick={onRefresh} disabled={loading || !filters.bcId} title="Re-fetch from TikTok (bypasses the short cache)">
              {loading ? <Spinner /> : <RefreshCw className="size-3.5" />}
              Refresh Data
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

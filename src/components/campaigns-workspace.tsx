"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, Download } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/hooks/use-api";
import { useFilters, type Filters } from "@/hooks/use-filters";
import { moneyByCurrency, pct } from "@/lib/client/format";
import type { AdAccount, CampaignRow, DashboardKpis, DataNotice } from "@/types";
import { ActionModal, type ActionKind, type ActionTarget } from "./action-modal";
import { CampaignDrawer } from "./campaign-drawer";
import { CampaignTable, rowKey } from "./campaign-table";
import { ErrorBox, Notices } from "./common";
import { FilterBar, type FilterBarProps } from "./filter-bar";
import { Button, Card, Empty } from "./ui";

export interface DashboardResponse {
  rangeLabel: string;
  range: { start: string; end: string };
  kpis: DashboardKpis;
  items: CampaignRow[];
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  appOptions: Array<{ appId: string; name: string }>;
  accounts: AdAccount[];
  notices: DataNotice[];
  lastUpdated: string;
}

export function KpiCards({ kpis, rangeLabel }: { kpis: DashboardKpis; rangeLabel: string }) {
  const cards = [
    { label: `Total Spend — ${rangeLabel}`, value: moneyByCurrency(kpis.totalSpend), title: Object.keys(kpis.totalSpend).length > 1 ? "Currencies are shown separately and never summed" : undefined },
    { label: `Average IAA D0 ROAS — ${rangeLabel}`, value: pct(kpis.avgIaaRoas), title: kpis.avgIaaRoas.ok ? "Spend-weighted: total D0 IAA revenue / total spend" : kpis.avgIaaRoas.reason },
    { label: "Active Campaigns", value: kpis.activeCampaigns.toLocaleString(), title: "TikTok status CAMPAIGN_STATUS_ENABLE" },
    { label: "Active Apps", value: kpis.activeApps.toLocaleString(), title: "Apps with ≥1 campaign in TikTok status ENABLE" },
    { label: "Ad Accounts", value: kpis.adAccounts.toLocaleString() },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className="px-3 py-2.5">
          <div className="text-[11px] text-muted">{c.label}</div>
          <div className="mt-1 truncate text-lg font-semibold tabular" title={c.title ?? c.value}>
            {c.value}
          </div>
          {c.label.startsWith("Average") && !kpis.avgIaaRoas.ok && <div className="truncate text-[11px] text-muted">{kpis.avgIaaRoas.reason}</div>}
        </Card>
      ))}
    </div>
  );
}

export function ExportMenu({ query, selected, extra }: { query: URLSearchParams; selected: string[]; extra?: Array<{ label: string; type: string }> }) {
  const href = (type: string, format: string) => {
    const q = new URLSearchParams(query);
    q.set("type", type);
    q.set("format", format);
    if (type === "selected") q.set("campaignIds", selected.join(","));
    return `/api/export?${q}`;
  };
  const items = [
    { label: "Export Current View", type: "current_view" },
    { label: "Export All Running Apps", type: "running_apps" },
    { label: "Export All Active Campaigns", type: "active_campaigns" },
    { label: `Export Selected Campaigns (${selected.length})`, type: "selected", disabled: !selected.length },
    ...(extra ?? []),
  ];
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button size="sm">
          <Download className="size-3.5" /> Export <ChevronDown className="size-3" />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" className="z-30 min-w-64 rounded-md border border-border bg-surface p-1 shadow-lg">
          {items.map((i) => (
            <div key={i.type} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[13px]">
              <span className={"disabled" in i && i.disabled ? "text-muted" : ""}>{i.label}</span>
              <span className="flex gap-1">
                {["csv", "xlsx"].map((f) =>
                  "disabled" in i && i.disabled ? (
                    <span key={f} className="text-xs text-muted">
                      {f.toUpperCase()}
                    </span>
                  ) : (
                    <Dropdown.Item key={f} asChild>
                      <a className="rounded border border-border px-1.5 text-xs outline-none hover:bg-surface-2" href={href(i.type, f)}>
                        {f.toUpperCase()}
                      </a>
                    </Dropdown.Item>
                  ),
                )}
              </span>
            </div>
          ))}
          <div className="px-2 pt-1 text-[11px] text-muted">Exports respect the current filters and date range.</div>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function useActionFlow(onCompleted: () => void) {
  const [state, setState] = useState<{ action: ActionKind; targets: ActionTarget[]; source?: "MANUAL" | "RULE_SUGGESTION"; ruleId?: string | null; initialPct?: number } | null>(null);
  const start = useCallback((action: ActionKind, targets: ActionTarget[], extra: { source?: "MANUAL" | "RULE_SUGGESTION"; ruleId?: string | null; initialPct?: number } = {}) => setState({ action, targets, ...extra }), []);
  const modal = (
    <ActionModal
      open={!!state}
      onOpenChange={(o) => !o && setState(null)}
      action={state?.action ?? null}
      targets={state?.targets ?? []}
      source={state?.source}
      ruleId={state?.ruleId}
      initialPct={state?.initialPct}
      onCompleted={onCompleted}
    />
  );
  return { start, modal };
}

export interface WorkspaceCtx {
  filters: Filters;
  apiQuery: URLSearchParams;
  startAction: ReturnType<typeof useActionFlow>["start"];
}

export function CampaignsWorkspace({
  overrides,
  header,
  hideKpis,
  show,
}: {
  overrides?: Partial<Filters>;
  header?: (ctx: WorkspaceCtx) => ReactNode;
  hideKpis?: boolean;
  show?: FilterBarProps["show"];
}) {
  const { filters, set, apiQuery } = useFilters(overrides);
  const path = filters.bcId ? `/api/dashboard?${apiQuery}` : null;
  const { data, error, loading, reload } = useApi<DashboardResponse>(path);
  const [selected, setSelected] = useState<Map<string, CampaignRow>>(new Map());
  const [drawer, setDrawer] = useState<{ advertiserId: string; campaignId: string } | null>(null);

  const refreshAfterAction = useCallback(() => void reload(false), [reload]);
  const flow = useActionFlow(refreshAfterAction);

  const selection: RowSelectionState = useMemo(() => Object.fromEntries([...selected.keys()].map((k) => [k, true])), [selected]);
  const onSelection = (s: RowSelectionState) => {
    const next = new Map<string, CampaignRow>();
    for (const [k, on] of Object.entries(s)) {
      if (!on) continue;
      const row = selected.get(k) ?? data?.items.find((r) => rowKey(r) === k);
      if (row) next.set(k, row);
    }
    setSelected(next);
  };
  const selectedRows = [...selected.values()];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={filters}
        set={set}
        appOptions={data?.appOptions}
        show={show}
        rangeLabel={data?.rangeLabel}
        lastUpdated={data?.lastUpdated}
        loading={loading}
        onRefresh={() => reload(true)}
      />
      {header?.({ filters, apiQuery, startAction: flow.start })}
      {!filters.bcId && (
        <Card>
          <Empty>Select a Business Center to load ad accounts, running apps and campaigns.</Empty>
        </Card>
      )}
      <ErrorBox error={error} onRetry={() => reload()} />
      {data && (
        <>
          <Notices notices={data.notices} />
          {!hideKpis && <KpiCards kpis={data.kpis} rangeLabel={data.rangeLabel} />}
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <Button size="sm" variant={selectedRows.length ? "primary" : "outline"} disabled={!selectedRows.length}>
                  Bulk Actions ({selectedRows.length}) <ChevronDown className="size-3" />
                </Button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="start" className="z-30 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg">
                  {(
                    [
                      ["Increase Budget", { kind: "budget", direction: "increase" }],
                      ["Decrease Budget", { kind: "budget", direction: "decrease" }],
                      ["Turn OFF", { kind: "status", action: "TURN_OFF" }],
                      ["Turn ON", { kind: "status", action: "TURN_ON" }],
                    ] as Array<[string, ActionKind]>
                  ).map(([label, a]) => (
                    <Dropdown.Item key={label} className="cursor-pointer rounded px-2 py-1 text-[13px] outline-none hover:bg-surface-2" onSelect={() => flow.start(a, selectedRows)}>
                      {label}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
            {selectedRows.length > 0 && (
              <button className="text-xs text-muted underline" onClick={() => setSelected(new Map())}>
                Clear selection
              </button>
            )}
            <div className="ml-auto">
              <ExportMenu query={apiQuery} selected={selectedRows.map((r) => r.campaignId)} />
            </div>
          </div>
          <CampaignTable
            rows={data.items}
            rangeLabel={data.rangeLabel}
            sort={filters.sort}
            dir={filters.dir}
            onSort={(sort, dir) => set({ sort, dir })}
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPage={(p) => set({ page: String(p) }, { resetPage: false })}
            onPageSize={(n) => set({ pageSize: String(n) })}
            onOpen={(r) => setDrawer({ advertiserId: r.advertiserId, campaignId: r.campaignId })}
            onAction={flow.start}
            selection={selection}
            onSelection={onSelection}
            loading={loading}
          />
        </>
      )}
      <CampaignDrawer target={drawer} query={apiQuery.toString()} onClose={() => setDrawer(null)} onAction={flow.start} />
      {flow.modal}
    </div>
  );
}

"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Columns3, Minus, Pause, Play, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/client/format";
import type { CampaignRow } from "@/types";
import type { ActionKind, ActionTarget } from "./action-modal";
import { IaaCell, Mono, StatusBadge } from "./common";
import { Button, cn, Empty } from "./ui";

const VIS_KEY = "tacc:campaignColumns";

export interface CampaignTableProps {
  rows: CampaignRow[];
  rangeLabel: string;
  sort: string;
  dir: string;
  onSort: (key: string, dir: "asc" | "desc") => void;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  onOpen: (row: CampaignRow) => void;
  onAction: (a: ActionKind, targets: ActionTarget[]) => void;
  selection: RowSelectionState;
  onSelection: (s: RowSelectionState) => void;
  loading?: boolean;
}

export const rowKey = (r: Pick<CampaignRow, "advertiserId" | "campaignId">) => `${r.advertiserId}:${r.campaignId}`;

export function CampaignTable(p: CampaignTableProps) {
  const [visibility, setVisibility] = useState<VisibilityState>({});
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIS_KEY);
      if (v) setVisibility(JSON.parse(v));
    } catch {}
  }, []);
  const updateVisibility = (v: VisibilityState) => {
    setVisibility(v);
    try {
      localStorage.setItem(VIS_KEY, JSON.stringify(v));
    } catch {}
  };

  const columns = useMemo<ColumnDef<CampaignRow>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <input type="checkbox" aria-label="Select page" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />
        ),
        cell: ({ row }) => <input type="checkbox" aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />,
      },
      { id: "status", header: "Status", meta: { sort: "status" }, cell: ({ row: { original: r } }) => <StatusBadge secondaryStatus={r.secondaryStatus} operationStatus={r.operationStatus} /> },
      { id: "bcId", header: "BC ID", meta: { sort: "bcId" }, cell: ({ row: { original: r } }) => <Mono className="text-muted">{r.bcId}</Mono> },
      {
        id: "advertiserId",
        header: "Ad Account ID",
        meta: { sort: "advertiserId" },
        cell: ({ row: { original: r } }) => (
          <div className="max-w-40">
            <Mono>{r.advertiserId}</Mono>
            <div className="truncate text-[11px] text-muted" title={r.advertiserName}>
              {r.advertiserName}
            </div>
          </div>
        ),
      },
      {
        id: "app",
        header: "App",
        meta: { sort: "app" },
        cell: ({ row: { original: r } }) =>
          r.appId ? (
            <div className="max-w-44">
              <div className="truncate" title={r.appName ?? undefined}>
                {r.appName ?? "N/A"}
              </div>
              <Mono className="text-[11px] text-muted">{r.appId}</Mono>
            </div>
          ) : (
            <span className="text-muted" title="Non-app campaign (no app_id on campaign or ad groups)">
              N/A
            </span>
          ),
      },
      {
        id: "campaign",
        header: "Campaign",
        meta: { sort: "campaign" },
        cell: ({ row: { original: r } }) => (
          <div className="max-w-72">
            <div className="truncate font-medium" title={r.campaignName}>
              {r.campaignName}
            </div>
            <div className="text-[11px] text-muted">
              {r.objectiveType}
              {r.automationType !== "MANUAL" ? ` · ${r.automationType}` : ""}
            </div>
          </div>
        ),
      },
      { id: "campaignId", header: "Campaign ID", meta: { sort: "campaignId" }, cell: ({ row: { original: r } }) => <Mono>{r.campaignId}</Mono> },
      {
        id: "budget",
        header: "Budget",
        meta: { sort: "budget", align: "right" },
        cell: ({ row: { original: r } }) =>
          r.budget.amount != null ? (
            <span className="tabular">
              {money(r.budget.amount, r.currency)}
              <span className="text-[11px] text-muted">{r.budget.label}</span>
            </span>
          ) : (
            <span className="text-muted">{r.budget.label}</span>
          ),
      },
      {
        id: "spend",
        header: `Spend — ${p.rangeLabel}`,
        meta: { sort: "spend", align: "right" },
        cell: ({ row: { original: r } }) => <span className="tabular font-medium">{money(r.metrics.spend, r.currency)}</span>,
      },
      { id: "roas", header: `IAA D0 ROAS — ${p.rangeLabel}`, meta: { sort: "roas", align: "right" }, cell: ({ row: { original: r } }) => <IaaCell iaa={r.iaa} compact /> },
      {
        id: "topGeo",
        header: "Top Geo",
        meta: { sort: "topGeo" },
        cell: ({ row: { original: r } }) =>
          r.topGeo ? (
            <div className="tabular">
              <span className="font-medium">{r.topGeo.countryCode === "None" ? "Unknown" : r.topGeo.countryCode}</span>{" "}
              <span className="text-[11px] text-muted">{money(r.topGeo.spend, r.currency)}</span>
              {r.topGeo.iaa.roasPct.ok && <div className="text-[11px]">ROAS {r.topGeo.iaa.roasPct.value.toFixed(1)}%</div>}
            </div>
          ) : (
            <span className="text-muted">N/A</span>
          ),
      },
      {
        id: "topCreative",
        header: "Top Creative",
        meta: { sort: "topCreative" },
        cell: ({ row: { original: r } }) => {
          const c = r.topCreative.creative;
          if (!c) return <span className="text-muted" title={r.topCreative.basis}>N/A</span>;
          return (
            <div className="max-w-56" title={r.topCreative.basis}>
              <div className="truncate">{c.adName || <Mono>{c.adId}</Mono>}</div>
              <div className="text-[11px] text-muted tabular">
                <Mono>{c.adId}</Mono> · {money(c.spend, r.currency)}
                {c.iaa.roasPct.ok ? ` · ${c.iaa.roasPct.value.toFixed(1)}%` : ""}
              </div>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        enableHiding: false,
        cell: ({ row: { original: r } }) => {
          const t: ActionTarget[] = [r];
          return (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" title={r.writeSupport.budget.ok ? "Increase budget" : r.writeSupport.budget.reason} disabled={!r.writeSupport.budget.ok} onClick={() => p.onAction({ kind: "budget", direction: "increase" }, t)}>
                <Plus className="size-3" />
              </Button>
              <Button size="sm" title={r.writeSupport.budget.ok ? "Decrease budget" : r.writeSupport.budget.reason} disabled={!r.writeSupport.budget.ok} onClick={() => p.onAction({ kind: "budget", direction: "decrease" }, t)}>
                <Minus className="size-3" />
              </Button>
              {r.operationStatus === "ENABLE" ? (
                <Button size="sm" title={r.writeSupport.status.ok ? "Turn OFF" : r.writeSupport.status.reason} disabled={!r.writeSupport.status.ok} onClick={() => p.onAction({ kind: "status", action: "TURN_OFF" }, t)}>
                  <Pause className="size-3" /> OFF
                </Button>
              ) : r.operationStatus === "DISABLE" ? (
                <Button size="sm" title={r.writeSupport.status.ok ? "Turn ON" : r.writeSupport.status.reason} disabled={!r.writeSupport.status.ok} onClick={() => p.onAction({ kind: "status", action: "TURN_ON" }, t)}>
                  <Play className="size-3" /> ON
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.rangeLabel, p.onAction],
  );

  const table = useReactTable({
    data: p.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: rowKey,
    manualSorting: true,
    manualPagination: true,
    state: { columnVisibility: visibility, rowSelection: p.selection },
    onColumnVisibilityChange: (u) => updateVisibility(typeof u === "function" ? u(visibility) : u),
    onRowSelectionChange: (u) => p.onSelection(typeof u === "function" ? u(p.selection) : u),
    enableRowSelection: true,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <Button size="sm">
              <Columns3 className="size-3.5" /> Columns
            </Button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" className="z-30 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg">
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <Dropdown.CheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] outline-none hover:bg-surface-2"
                  >
                    <input type="checkbox" readOnly checked={c.getIsVisible()} />
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </Dropdown.CheckboxItem>
                ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>

      <div className={cn("max-h-[calc(100vh-280px)] overflow-auto rounded-lg border border-border bg-surface", p.loading && "opacity-60")}>
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as { sort?: string; align?: string } | undefined;
                  const active = meta?.sort && p.sort === meta.sort;
                  return (
                    <th
                      key={h.id}
                      className={cn(
                        "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted",
                        meta?.align === "right" && "text-right",
                        meta?.sort && "cursor-pointer select-none hover:text-fg",
                      )}
                      onClick={() => meta?.sort && p.onSort(meta.sort, active && p.dir === "desc" ? "asc" : "desc")}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {active && (p.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="cursor-pointer hover:bg-surface-2" onClick={() => p.onOpen(row.original)}>
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as { align?: string } | undefined;
                  return (
                    <td key={cell.id} className={cn("border-b border-border px-2.5 py-1.5 align-top", meta?.align === "right" && "text-right")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!p.rows.length && <Empty>{p.loading ? "Loading campaigns from TikTok…" : "No campaigns match the current filters."}</Empty>}
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {p.total.toLocaleString()} campaigns · page {p.page} of {p.totalPages}
        </span>
        <div className="flex items-center gap-1">
          <select className="h-7 rounded border border-border bg-surface px-1" value={p.pageSize} onChange={(e) => p.onPageSize(Number(e.target.value))}>
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <Button size="sm" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>
            Prev
          </Button>
          <Button size="sm" disabled={p.page >= p.totalPages} onClick={() => p.onPage(p.page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Fragment, useState } from "react";
import { ErrorBox, Mono } from "@/components/common";
import { Badge, Button, Card, Empty, Field, Input, Select } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { qs } from "@/lib/client/api";
import { dateTime, money } from "@/lib/client/format";

interface Log {
  id: string;
  createdAt: string;
  operator: string;
  bcId: string | null;
  advertiserId: string;
  campaignName: string;
  campaignId: string;
  actionType: string;
  beforeValue: string;
  afterValue: string;
  verifiedValue: string | null;
  currency: string | null;
  status: string;
  errorMessage: string | null;
  mcpTool: string;
  mcpRequest: unknown;
  mcpResponse: unknown;
  source: string;
  limitOverride: boolean;
}

const ACTION: Record<string, string> = { BUDGET_INCREASE: "Budget Increase", BUDGET_DECREASE: "Budget Decrease", TURN_ON: "Turn ON", TURN_OFF: "Turn OFF" };
const STATUS_CLS: Record<string, string> = {
  SUCCESS: "border-ok/30 text-ok",
  FAILED: "border-danger/40 text-danger",
  VERIFICATION_FAILED: "border-danger/40 text-danger",
  EXECUTING: "border-warn/40 text-warn",
};

const fmtVal = (l: Log, v: string | null) => (v == null ? "—" : l.actionType.startsWith("BUDGET") && !Number.isNaN(Number(v)) ? money(Number(v), l.currency) : v === "ENABLE" ? "ACTIVE" : v === "DISABLE" ? "PAUSED" : v);

/** Immutable audit trail of every confirmed write action. */
export default function ActionsLogPage() {
  const [f, setF] = useState({ from: "", to: "", q: "", status: "", page: 1 });
  const query = qs({ ...f, pageSize: 50 });
  const { data, error, loading, reload } = useApi<{ items: Log[]; total: number; page: number; totalPages: number }>(`/api/actions/log?${query}`);
  const [open, setOpen] = useState<string | null>(null);
  const exportQ = qs({ from: f.from, to: f.to, q: f.q, status: f.status, type: "action_log" });

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <Field label="From">
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} />
        </Field>
        <Field label="To">
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
            <option value="">All</option>
            <option>SUCCESS</option>
            <option>FAILED</option>
            <option>VERIFICATION_FAILED</option>
            <option>EXECUTING</option>
          </Select>
        </Field>
        <Field label="Search" className="flex-1">
          <Input placeholder="Campaign, campaign ID, account ID, user" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
        </Field>
        <Button onClick={() => reload()} disabled={loading}>
          Refresh
        </Button>
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 hover:bg-surface-2" href={`/api/export?${exportQ}&format=csv`}>
          Export CSV
        </a>
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 hover:bg-surface-2" href={`/api/export?${exportQ}&format=xlsx`}>
          Export XLSX
        </a>
      </Card>
      <ErrorBox error={error} onRetry={() => reload()} />
      <div className="max-h-[calc(100vh-240px)] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              {["Timestamp", "User", "BC ID", "Ad Account ID", "Campaign", "Campaign ID", "Action", "Before", "After", "Status", "Error Message"].map((h) => (
                <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <Fragment key={l.id}>
                <tr className="cursor-pointer align-top hover:bg-surface-2" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td className="whitespace-nowrap border-b border-border px-2.5 py-1.5 tabular">{dateTime(l.createdAt)}</td>
                  <td className="border-b border-border px-2.5 py-1.5">{l.operator}</td>
                  <td className="border-b border-border px-2.5 py-1.5">
                    <Mono className="text-muted">{l.bcId ?? "—"}</Mono>
                  </td>
                  <td className="border-b border-border px-2.5 py-1.5">
                    <Mono>{l.advertiserId}</Mono>
                  </td>
                  <td className="max-w-64 truncate border-b border-border px-2.5 py-1.5" title={l.campaignName}>
                    {l.campaignName}
                  </td>
                  <td className="border-b border-border px-2.5 py-1.5">
                    <Mono>{l.campaignId}</Mono>
                  </td>
                  <td className="border-b border-border px-2.5 py-1.5">
                    {ACTION[l.actionType] ?? l.actionType}
                    {l.source !== "MANUAL" && <div className="text-[11px] text-muted">{l.source}</div>}
                    {l.limitOverride && <div className="text-[11px] text-danger">limit override</div>}
                  </td>
                  <td className="border-b border-border px-2.5 py-1.5 tabular">{fmtVal(l, l.beforeValue)}</td>
                  <td className="border-b border-border px-2.5 py-1.5 tabular">
                    {fmtVal(l, l.afterValue)}
                    {l.verifiedValue && l.verifiedValue !== l.afterValue && <div className="text-[11px] text-danger">TikTok: {fmtVal(l, l.verifiedValue)}</div>}
                  </td>
                  <td className="border-b border-border px-2.5 py-1.5">
                    <Badge className={STATUS_CLS[l.status] ?? ""}>{l.status}</Badge>
                  </td>
                  <td className="max-w-80 border-b border-border px-2.5 py-1.5 text-xs text-danger">{l.errorMessage}</td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={11} className="border-b border-border bg-surface-2 px-3 py-2">
                      <div className="grid gap-2 text-xs md:grid-cols-2">
                        <div>
                          <div className="font-medium">MCP request · {l.mcpTool}</div>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-[11px]">{JSON.stringify(l.mcpRequest, null, 2)}</pre>
                        </div>
                        <div>
                          <div className="font-medium">MCP response</div>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-[11px]">{JSON.stringify(l.mcpResponse, null, 2) ?? "—"}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data && !data.items.length && <Empty>No actions recorded for this filter.</Empty>}
      </div>
      {data && (
        <div className="flex justify-end gap-1 text-xs text-muted">
          <span className="mr-2 self-center">
            {data.total} actions · page {data.page} of {data.totalPages}
          </span>
          <Button size="sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>
            Prev
          </Button>
          <Button size="sm" disabled={f.page >= data.totalPages} onClick={() => setF({ ...f, page: f.page + 1 })}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

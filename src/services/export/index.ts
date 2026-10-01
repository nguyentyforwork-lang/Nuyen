import ExcelJS from "exceljs";
import type { AppRow, CampaignRow, Iaa } from "@/types";

export type Cell = string | number | null;
export interface Table {
  title: string;
  columns: string[];
  rows: Cell[][];
}

/** Prevents spreadsheet formula injection from campaign/creative names. */
export function sanitize(v: Cell): Cell {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}

export function toCsv(t: Table): string {
  const esc = (v: Cell) => {
    const s = v == null ? "" : String(sanitize(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TikTok Ads Control Center";
  const ws = wb.addWorksheet("Export");
  ws.addRow([t.title]).font = { bold: true };
  const header = ws.addRow(t.columns);
  header.font = { bold: true };
  for (const r of t.rows) ws.addRow(r.map(sanitize));
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.columns.forEach((c) => (c.width = 18));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const roas = (i: Iaa): Cell => (i.roasPct.ok ? Number(i.roasPct.value.toFixed(2)) : "N/A");
const money = (n: number | null): Cell => (n == null ? "N/A" : Number(n.toFixed(2)));

export function campaignTable(rows: CampaignRow[], rangeLabel: string, title: string): Table {
  return {
    title: `${title} — ${rangeLabel}`,
    columns: [
      "Status (TikTok)",
      "BC ID",
      "Ad Account ID",
      "Ad Account",
      "Currency",
      "App Name",
      "App ID",
      "Campaign Name",
      "Campaign ID",
      "Budget",
      "Budget Mode",
      `Spend — ${rangeLabel}`,
      `IAA D0 ROAS % — ${rangeLabel}`,
      "Top Geo",
      "Top Geo Spend",
      "Top Creative",
      "Top Creative ID",
      "Top Creative Spend",
      "Top Creative IAA D0 ROAS %",
      "Last Updated",
    ],
    rows: rows.map((r) => [
      r.secondaryStatus,
      r.bcId,
      r.advertiserId,
      r.advertiserName,
      r.currency,
      r.appName ?? "N/A",
      r.appId ?? "N/A",
      r.campaignName,
      r.campaignId,
      money(r.budget.amount),
      r.budget.mode,
      money(r.metrics.spend),
      roas(r.iaa),
      r.topGeo?.countryCode ?? "N/A",
      money(r.topGeo?.spend ?? null),
      r.topCreative.creative ? (r.topCreative.creative.adName ?? r.topCreative.creative.adId) : "N/A",
      r.topCreative.creative?.adId ?? "N/A",
      money(r.topCreative.creative?.spend ?? null),
      r.topCreative.creative ? roas(r.topCreative.creative.iaa) : "N/A",
      r.lastUpdated,
    ]),
  };
}

export function appTable(apps: AppRow[], rangeLabel: string): Table {
  return {
    title: `Running apps — ${rangeLabel}`,
    columns: [
      "BC ID",
      "Ad Account ID",
      "Currency",
      "App Name",
      "App ID",
      "Active Campaign Count",
      `Spend — ${rangeLabel}`,
      `IAA D0 ROAS % — ${rangeLabel}`,
      "Top Geo",
      "Top Creative",
      "Top Creative ID",
    ],
    rows: apps.map((a) => [
      a.bcId,
      a.advertiserId,
      a.currency,
      a.appName,
      a.appId,
      a.activeCampaigns,
      money(a.spend),
      roas(a.iaa),
      a.topGeo?.countryCode ?? "N/A",
      a.topCreative.creative ? (a.topCreative.creative.adName ?? a.topCreative.creative.adId) : "N/A",
      a.topCreative.creative?.adId ?? "N/A",
    ]),
  };
}

export function actionLogTable(
  items: Array<{
    createdAt: Date;
    operator: string;
    bcId: string | null;
    advertiserId: string;
    campaignName: string;
    campaignId: string;
    actionType: string;
    beforeValue: string;
    afterValue: string;
    verifiedValue: string | null;
    status: string;
    errorMessage: string | null;
    mcpTool: string;
    source: string;
  }>,
): Table {
  return {
    title: "Action log",
    columns: ["Timestamp (UTC)", "User", "BC ID", "Ad Account ID", "Campaign", "Campaign ID", "Action", "Before", "After", "Verified", "Status", "Error Message", "MCP Tool", "Source"],
    rows: items.map((i) => [
      i.createdAt.toISOString(),
      i.operator,
      i.bcId,
      i.advertiserId,
      i.campaignName,
      i.campaignId,
      i.actionType,
      i.beforeValue,
      i.afterValue,
      i.verifiedValue,
      i.status,
      i.errorMessage,
      i.mcpTool,
      i.source,
    ]),
  };
}

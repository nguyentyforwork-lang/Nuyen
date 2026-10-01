import { z } from "zod";
import { listActionLogs } from "@/db/repo";
import { handle, HttpError, requireOperator } from "@/lib/http";
import { parseDatasetParams } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { filterRows, sortRows, type SortKey } from "@/services/dashboard/query";
import { actionLogTable, appTable, campaignTable, toCsv, toXlsx, type Table } from "@/services/export";

const q = z.object({
  type: z.enum(["current_view", "running_apps", "active_campaigns", "selected", "action_log"]),
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

/** Exports respect the same filters as the screen they are triggered from. */
export const GET = handle(async (req) => {
  requireOperator(req);
  const { type, format } = q.parse({ type: req.nextUrl.searchParams.get("type"), format: req.nextUrl.searchParams.get("format") ?? undefined });
  let table: Table;
  let name: string;

  if (type === "action_log") {
    const sp = req.nextUrl.searchParams;
    const { items } = await listActionLogs({ from: sp.get("from"), to: sp.get("to"), q: sp.get("q"), status: sp.get("status") || null, limit: 50_000 });
    table = actionLogTable(items);
    name = "action-log";
  } else {
    const p = parseDatasetParams(req);
    const ds = await loadDataset({ bcId: p.bcId, advertiserId: p.advertiserId, range: p.range, minCreativeSpend: p.minCreativeSpend });
    const tag = `${p.bcId}_${p.range.start}_${p.range.end}`;
    if (type === "running_apps") {
      const apps = ds.apps.filter((a) => a.running && (!p.advertiserId || a.advertiserId === p.advertiserId));
      table = appTable(apps, p.rangeLabel);
      name = `running-apps_${tag}`;
    } else {
      const base = { advertiserId: p.advertiserId, appId: p.appId, q: p.q, runningAppsOnly: p.runningAppsOnly };
      const rows =
        type === "active_campaigns"
          ? filterRows(ds.rows, { ...base, status: "ACTIVE" })
          : type === "selected"
            ? (() => {
                if (!p.campaignIds?.length) throw new HttpError(400, "No campaigns selected");
                return filterRows(ds.rows, { campaignIds: p.campaignIds, status: "ALL" });
              })()
            : filterRows(ds.rows, { ...base, status: p.status });
      table = campaignTable(sortRows(rows, (p.sort as SortKey) || "spend", p.dir), p.rangeLabel, type === "active_campaigns" ? "Active campaigns" : type === "selected" ? "Selected campaigns" : "Campaigns (current view)");
      name = `${type.replace("_", "-")}_${tag}`;
    }
  }

  if (format === "xlsx") {
    return new Response(new Uint8Array(await toXlsx(table)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(toCsv(table), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
});

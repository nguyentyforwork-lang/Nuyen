import { NextResponse } from "next/server";
import { handle, requireOperator } from "@/lib/http";
import { parseDatasetParams } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { appsView } from "@/services/dashboard/views";

export const GET = handle(async (req) => {
  requireOperator(req);
  const p = parseDatasetParams(req);
  const ds = await loadDataset({ bcId: p.bcId, advertiserId: p.advertiserId, range: p.range, minCreativeSpend: p.minCreativeSpend, force: p.force });
  const view = appsView(ds, { advertiserId: p.advertiserId, status: p.status, runningAppsOnly: p.runningAppsOnly, q: p.q, page: p.page, pageSize: p.pageSize });
  return NextResponse.json({ range: p.range, rangeLabel: p.rangeLabel, accounts: ds.accounts, notices: ds.notices, lastUpdated: ds.lastUpdated, iaa: ds.iaa, ...view });
});

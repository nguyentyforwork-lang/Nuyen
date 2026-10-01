import { NextResponse } from "next/server";
import { handle, requireOperator } from "@/lib/http";
import { parseDatasetParams } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { campaignsView } from "@/services/dashboard/views";

/** Campaign table + KPIs, filtered/sorted/paginated server-side. */
export const GET = handle(async (req) => {
  requireOperator(req);
  const p = parseDatasetParams(req);
  const ds = await loadDataset({ bcId: p.bcId, advertiserId: p.advertiserId, range: p.range, minCreativeSpend: p.minCreativeSpend, force: p.force });
  const view = campaignsView(ds, {
    appId: p.appId,
    status: p.status,
    q: p.q,
    runningAppsOnly: p.runningAppsOnly,
    campaignIds: p.campaignIds,
    sort: p.sort,
    dir: p.dir,
    page: p.page,
    pageSize: p.pageSize,
  });
  return NextResponse.json({
    range: p.range,
    rangeLabel: p.rangeLabel,
    accounts: ds.accounts,
    notices: ds.notices,
    lastUpdated: ds.lastUpdated,
    iaa: ds.iaa,
    minCreativeSpend: ds.minCreativeSpend,
    ...view,
  });
});

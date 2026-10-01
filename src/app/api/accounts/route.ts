import { NextResponse } from "next/server";
import { handle, requireOperator } from "@/lib/http";
import { parseDatasetParams } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { accountSummaries } from "@/services/dashboard/views";
import { paginate } from "@/services/dashboard/query";

export const GET = handle(async (req) => {
  requireOperator(req);
  const p = parseDatasetParams(req);
  const ds = await loadDataset({ bcId: p.bcId, range: p.range, minCreativeSpend: p.minCreativeSpend, force: p.force });
  const q = p.q?.toLowerCase();
  const items = accountSummaries(ds).filter((a) => !q || a.name.toLowerCase().includes(q) || a.advertiserId.includes(q));
  return NextResponse.json({ range: p.range, rangeLabel: p.rangeLabel, notices: ds.notices, lastUpdated: ds.lastUpdated, ...paginate(items, p.page, p.pageSize) });
});

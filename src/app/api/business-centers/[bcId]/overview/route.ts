import { NextResponse } from "next/server";
import { handle, requireOperator } from "@/lib/http";
import { parseDatasetParams } from "@/lib/params";
import { loadDataset } from "@/services/dashboard/dataset";
import { bcOverview } from "@/services/dashboard/views";

export const GET = handle<RouteContext<"/api/business-centers/[bcId]/overview">>(async (req, ctx) => {
  requireOperator(req);
  const { bcId } = await ctx.params;
  req.nextUrl.searchParams.set("bcId", bcId);
  const p = parseDatasetParams(req);
  const ds = await loadDataset({ bcId: p.bcId, range: p.range, minCreativeSpend: p.minCreativeSpend, force: p.force });
  return NextResponse.json({ range: p.range, rangeLabel: p.rangeLabel, notices: ds.notices, lastUpdated: ds.lastUpdated, ...bcOverview(ds) });
});

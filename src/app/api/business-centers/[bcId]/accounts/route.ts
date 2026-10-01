import { NextResponse } from "next/server";
import { handle, requireOperator } from "@/lib/http";
import { tiktokId } from "@/lib/params";
import { getTikTokService } from "@/services/tiktok/reporting/service";

export const GET = handle<RouteContext<"/api/business-centers/[bcId]/accounts">>(async (req, ctx) => {
  requireOperator(req);
  const bcId = tiktokId.parse((await ctx.params).bcId);
  const items = await getTikTokService().getAdAccounts(bcId, req.nextUrl.searchParams.get("refresh") === "1");
  return NextResponse.json({ items });
});

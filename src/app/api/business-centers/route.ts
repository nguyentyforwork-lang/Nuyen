import { NextResponse } from "next/server";
import { handle, requireOperator } from "@/lib/http";
import { getTikTokService } from "@/services/tiktok/reporting/service";

export const GET = handle(async (req) => {
  requireOperator(req);
  const items = await getTikTokService().getBusinessCenters(req.nextUrl.searchParams.get("refresh") === "1");
  return NextResponse.json({ items });
});

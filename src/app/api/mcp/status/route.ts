import { NextResponse } from "next/server";
import { describeConfig } from "@/lib/config";
import { handle, requireOperator } from "@/lib/http";
import { toErrorPayload } from "@/services/tiktok/errors";
import { getTikTokService } from "@/services/tiktok/reporting/service";
import { evaluateCapabilities } from "@/services/tiktok/tool-registry";

/** Phase-1 verification: connection, discovered tools, capability mapping, auth (BC read), IAA metric. */
export const GET = handle(async (req) => {
  requireOperator(req);
  const config = describeConfig();
  if (!config.mcp.ok) return NextResponse.json({ config, connected: false });
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const svc = getTikTokService();
  try {
    const tools = await svc.client.discover(refresh);
    const capabilities = evaluateCapabilities(tools);
    let auth: { ok: boolean; businessCenters?: number; error?: unknown } = { ok: false };
    let iaa = svc.currentIaaMode;
    try {
      const bcs = await svc.getBusinessCenters(refresh);
      auth = { ok: true, businessCenters: bcs.length };
      if (!iaa && bcs.length) {
        const accounts = await svc.getAdAccounts(bcs[0].bcId);
        if (accounts.length) iaa = await svc.resolveIaaMode(accounts[0].advertiserId);
      }
    } catch (e) {
      auth = { ok: false, error: toErrorPayload(e) };
    }
    return NextResponse.json({
      config,
      connected: true,
      discoveredAt: svc.client.lastDiscoveredAt,
      toolCount: tools.size,
      writeToolsDiscovered: [...tools.keys()].filter((n) => /(_update|_create|_delete|_disable|_assign|_transfer)$/.test(n)).length,
      capabilities,
      auth,
      iaa,
    });
  } catch (e) {
    return NextResponse.json({ config, connected: false, error: toErrorPayload(e) });
  }
});

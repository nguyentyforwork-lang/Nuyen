"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { ErrorBox } from "@/components/common";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { dateTime } from "@/lib/client/format";
import type { CapabilityStatus } from "@/services/tiktok/tool-registry";

interface Status {
  config: Record<"mcp" | "db" | "app", { ok: boolean; error?: string }>;
  connected: boolean;
  discoveredAt?: string;
  toolCount?: number;
  writeToolsDiscovered?: number;
  capabilities?: CapabilityStatus[];
  auth?: { ok: boolean; businessCenters?: number; error?: { message: string } };
  iaa?: { kind: string; metric?: string; reason?: string } | null;
  error?: { message: string };
}

const Ok = ({ ok }: { ok: boolean }) => (ok ? <CheckCircle2 className="size-4 text-ok" aria-label="OK" /> : <XCircle className="size-4 text-danger" aria-label="Failed" />);

/** Phase-1 verification page: MCP connection, discovered tools, authentication, capability mapping. */
export default function McpStatusPage() {
  const { data, error, loading, reload } = useApi<Status>("/api/mcp/status");
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">TikTok MCP status</h1>
        <Button onClick={() => reload(true)} disabled={loading}>
          {loading && <Spinner />} Re-discover tools
        </Button>
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <Card className="grid gap-2 p-3 md:grid-cols-3">
            {(["mcp", "db", "app"] as const).map((k) => (
              <div key={k} className="flex items-start gap-2">
                <Ok ok={data.config[k].ok} />
                <div>
                  <div className="font-medium">{k === "mcp" ? "MCP configuration" : k === "db" ? "Database configuration" : "Application configuration"}</div>
                  {data.config[k].error && <div className="text-xs text-danger">{data.config[k].error}</div>}
                </div>
              </div>
            ))}
          </Card>
          <Card className="grid gap-2 p-3 md:grid-cols-3">
            <div className="flex items-center gap-2">
              <Ok ok={data.connected} /> MCP connection {data.connected ? `· ${data.toolCount} tools discovered` : ""}
            </div>
            <div className="flex items-center gap-2">
              <Ok ok={!!data.auth?.ok} /> Authentication {data.auth?.ok ? `· ${data.auth.businessCenters} Business Centers` : data.auth?.error?.message ?? ""}
            </div>
            <div className="text-xs text-muted">Discovered {dateTime(data.discoveredAt)}</div>
            {data.error && <div className="text-xs text-danger md:col-span-3">{data.error.message}</div>}
          </Card>
          {data.iaa && (
            <Card className="p-3">
              <div className="font-medium">IAA D0 ROAS source</div>
              <div className="text-xs">
                {data.iaa.kind === "unavailable" ? (
                  <span className="text-warn">{data.iaa.reason}</span>
                ) : (
                  <span className="text-ok">
                    {data.iaa.kind === "revenue_metric" ? "Computed as D0 IAA revenue / spend using metric" : "Official ROAS metric"} <code>{data.iaa.metric}</code> (validated against TikTok)
                  </span>
                )}
              </div>
            </Card>
          )}
          {data.capabilities && (
            <Card>
              <table className="w-full text-left text-[13px]">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Feature</th>
                    <th className="px-3 py-2">MCP tool</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Available</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.capabilities.map((c) => (
                    <tr key={c.capability} className="border-t border-border align-top">
                      <td className="px-3 py-1.5">{c.capability}</td>
                      <td className="px-3 py-1.5 font-mono text-[12px]">{c.tool}</td>
                      <td className="px-3 py-1.5">
                        <Badge className={c.kind === "write" ? "border-warn/40 text-warn" : "border-border text-muted"}>{c.kind.toUpperCase()}</Badge>
                      </td>
                      <td className="px-3 py-1.5">
                        <Ok ok={c.available} />
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted">{c.missingParams.length ? `Missing params: ${c.missingParams.join(", ")}` : c.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <p className="text-xs text-muted">
            Write tools are only invoked by the backend after an explicit confirmation. See <code>docs/MCP_TOOL_MAPPING.md</code> for the full feature → tool → parameters → limitations mapping.
          </p>
        </>
      )}
    </div>
  );
}

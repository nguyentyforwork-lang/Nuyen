"use client";

import { AlertTriangle, Info, XCircle } from "lucide-react";
import type { DataNotice, Iaa, StatusBucket } from "@/types";
import { ApiError } from "@/lib/client/api";
import { BUCKET_LABEL, statusBucket, statusLabel } from "@/services/tiktok/reporting/status";
import { Badge, cn } from "./ui";

const BUCKET_STYLE: Record<StatusBucket, { cls: string; dot: string }> = {
  ACTIVE: { cls: "border-ok/30 text-ok", dot: "bg-ok" },
  PAUSED: { cls: "border-border text-muted", dot: "bg-muted" },
  NOT_DELIVERING: { cls: "border-warn/40 text-warn", dot: "bg-warn" },
  PENDING: { cls: "border-info/40 text-info", dot: "bg-info" },
  DELETED: { cls: "border-danger/40 text-danger", dot: "bg-danger" },
  OTHER: { cls: "border-border text-fg", dot: "bg-fg" },
};

/** Shows TikTok's own status text (never only a colour), with the bucket as a tooltip. */
export function StatusBadge({ secondaryStatus, operationStatus }: { secondaryStatus: string; operationStatus?: string }) {
  const bucket = statusBucket(secondaryStatus, operationStatus);
  const s = BUCKET_STYLE[bucket];
  return (
    <Badge className={s.cls} title={`TikTok status: ${secondaryStatus} (${BUCKET_LABEL[bucket]})`}>
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {statusLabel(secondaryStatus)}
    </Badge>
  );
}

export function IaaCell({ iaa, compact }: { iaa: Iaa; compact?: boolean }) {
  if (iaa.roasPct.ok) {
    const v = iaa.roasPct.value;
    return <span className={cn("tabular font-medium", v >= 100 ? "text-ok" : v < 90 ? "text-danger" : "")}>{v.toFixed(1)}%</span>;
  }
  return (
    <span className="text-muted" title={iaa.roasPct.reason}>
      {compact ? "N/A" : iaa.roasPct.reason.startsWith("N/A") ? iaa.roasPct.reason : `N/A — ${iaa.roasPct.reason}`}
    </span>
  );
}

export function Notices({ notices }: { notices?: DataNotice[] }) {
  if (!notices?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {notices.map((n, i) => {
        const Icon = n.level === "error" ? XCircle : n.level === "warning" ? AlertTriangle : Info;
        return (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs",
              n.level === "error" ? "border-danger/40 text-danger" : n.level === "warning" ? "border-warn/40 text-warn" : "border-border text-muted",
            )}
          >
            <Icon className="mt-px size-3.5 shrink-0" />
            <span>{n.message}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null;
  const rate = error instanceof ApiError && error.isRateLimit;
  const body = error instanceof ApiError ? error.body : null;
  return (
    <div className="rounded-md border border-danger/40 px-3 py-2 text-danger">
      <div className="font-medium">{rate ? "TikTok API/MCP rate limit reached. Please retry later." : "Request failed"}</div>
      {!rate && <div className="text-xs">Reason: {error.message}</div>}
      {body?.tiktokCode && (
        <div className="text-xs opacity-80">
          TikTok code {body.tiktokCode}
          {body.requestId ? ` · request ${body.requestId}` : ""}
          {body.tool ? ` · tool ${body.tool}` : ""}
        </div>
      )}
      {onRetry && (
        <button className="mt-1 text-xs underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] tabular", className)}>{children}</span>;
}

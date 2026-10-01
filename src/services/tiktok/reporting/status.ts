import type { StatusBucket } from "@/types";

/**
 * Groups TikTok's own campaign `secondary_status` into the filter buckets the UI offers.
 * The raw TikTok status is always kept and displayed. The bucket only drives filtering.
 * Spend is never used to infer status.
 */
export function statusBucket(secondaryStatus: string | null | undefined, operationStatus?: string | null): StatusBucket {
  const s = (secondaryStatus ?? "").toUpperCase();
  if (s === "CAMPAIGN_STATUS_ENABLE") return "ACTIVE";
  if (s === "CAMPAIGN_STATUS_DISABLE") return "PAUSED";
  if (s === "CAMPAIGN_STATUS_DELETE") return "DELETED";
  if (/AUDIT$|REVIEW|PENDING|CONTRACT_PENDING|NOT_START|NOT_STARTED/.test(s)) return "PENDING";
  if (/BUDGET_EXCEED|PUNISH|DENY|REJECT|NO_BALANCE|BALANCE_EXCEED|NOT_DELIVER|LIMIT|FROZEN|CLOSED/.test(s)) {
    return "NOT_DELIVERING";
  }
  if (!s) {
    const op = (operationStatus ?? "").toUpperCase();
    if (op === "ENABLE") return "ACTIVE";
    if (op === "DISABLE") return "PAUSED";
  }
  return "OTHER";
}

/** Human label for TikTok's raw status, e.g. CAMPAIGN_STATUS_BUDGET_EXCEED → "Budget exceed". */
export function statusLabel(secondaryStatus: string | null | undefined): string {
  if (!secondaryStatus) return "Unknown";
  const t = secondaryStatus.replace(/^CAMPAIGN_STATUS_/, "").replace(/_/g, " ").toLowerCase();
  if (t === "enable") return "Active";
  if (t === "disable") return "Paused";
  if (t === "delete") return "Deleted";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const BUCKET_LABEL: Record<StatusBucket, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  NOT_DELIVERING: "Not delivering",
  PENDING: "Pending",
  DELETED: "Deleted",
  OTHER: "Other",
};

"use client";

import Link from "next/link";
import { money } from "@/lib/client/format";
import type { AppRow } from "@/types";
import { IaaCell, Mono } from "./common";
import { Badge, cn, Empty } from "./ui";

export function AppsTable({ apps, rangeLabel, carry, loading }: { apps: AppRow[]; rangeLabel: string; carry: URLSearchParams; loading?: boolean }) {
  const href = (a: AppRow) => {
    const q = new URLSearchParams(carry);
    q.delete("appId");
    q.delete("advertiserId");
    q.delete("page");
    return `/apps/${a.advertiserId}/${a.appId}?${q}`;
  };
  return (
    <div className={cn("max-h-[calc(100vh-260px)] overflow-auto rounded-lg border border-border bg-surface", loading && "opacity-60")}>
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            {["BC ID", "Ad Account ID", "App Name", "App ID", "Active Campaigns", `Total Spend — ${rangeLabel}`, `IAA D0 ROAS — ${rangeLabel}`, "Top Geo", "Top Creative", "Last Active", "Status"].map((h) => (
              <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={`${a.advertiserId}:${a.appId}`} className="hover:bg-surface-2">
              <td className="border-b border-border px-2.5 py-1.5">
                <Mono className="text-muted">{a.bcId}</Mono>
              </td>
              <td className="border-b border-border px-2.5 py-1.5">
                <Mono>{a.advertiserId}</Mono>
                <div className="max-w-40 truncate text-[11px] text-muted">{a.advertiserName}</div>
              </td>
              <td className="border-b border-border px-2.5 py-1.5 font-medium">
                <Link className="hover:underline" href={href(a)}>
                  {a.appName}
                </Link>
              </td>
              <td className="border-b border-border px-2.5 py-1.5">
                <Mono>{a.appId}</Mono>
              </td>
              <td className="border-b border-border px-2.5 py-1.5 tabular">
                {a.activeCampaigns} <span className="text-muted">/ {a.totalCampaigns}</span>
              </td>
              <td className="border-b border-border px-2.5 py-1.5 font-medium tabular">{money(a.spend, a.currency)}</td>
              <td className="border-b border-border px-2.5 py-1.5">
                <IaaCell iaa={a.iaa} compact />
              </td>
              <td className="border-b border-border px-2.5 py-1.5 tabular">
                {a.topGeo ? (
                  <>
                    <b>{a.topGeo.countryCode === "None" ? "Unknown" : a.topGeo.countryCode}</b> <span className="text-[11px] text-muted">{money(a.topGeo.spend, a.currency)}</span>
                  </>
                ) : (
                  <span className="text-muted">N/A</span>
                )}
              </td>
              <td className="max-w-56 border-b border-border px-2.5 py-1.5" title={a.topCreative.basis}>
                {a.topCreative.creative ? (
                  <>
                    <div className="truncate">{a.topCreative.creative.adName || a.topCreative.creative.adId}</div>
                    <div className="text-[11px] text-muted tabular">
                      <Mono>{a.topCreative.creative.adId}</Mono> · {money(a.topCreative.creative.spend, a.currency)}
                    </div>
                  </>
                ) : (
                  <span className="text-muted">N/A</span>
                )}
              </td>
              <td className="border-b border-border px-2.5 py-1.5 tabular text-muted">{a.lastActive ?? "—"}</td>
              <td className="border-b border-border px-2.5 py-1.5">
                {a.running ? <Badge className="border-ok/30 text-ok">Running</Badge> : <Badge className="border-border text-muted">Not running</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!apps.length && <Empty>{loading ? "Loading apps…" : "No apps match the current filters."}</Empty>}
    </div>
  );
}

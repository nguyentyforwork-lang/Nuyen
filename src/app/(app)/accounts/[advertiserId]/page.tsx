"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { AppsTable } from "@/components/apps-table";
import { CampaignsWorkspace } from "@/components/campaigns-workspace";
import { Mono } from "@/components/common";
import { useApi } from "@/hooks/use-api";
import type { AppRow } from "@/types";

function AccountApps({ apiQuery }: { apiQuery: URLSearchParams }) {
  const q = new URLSearchParams(apiQuery);
  q.set("status", "ALL");
  q.delete("page");
  q.set("pageSize", "200");
  const { data } = useApi<{ items: AppRow[]; rangeLabel: string }>(q.get("bcId") ? `/api/apps?${q}` : null);
  if (!data) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Apps in this account</h2>
      <AppsTable apps={data.items} rangeLabel={data.rangeLabel} carry={apiQuery} />
      <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Campaigns in this account</h2>
    </section>
  );
}

/** Account detail: all apps and campaigns belonging to the account. */
export default function AccountDetailPage() {
  const { advertiserId } = useParams<{ advertiserId: string }>();
  const sp = useSearchParams();
  const back = new URLSearchParams(sp);
  back.delete("advertiserId");
  return (
    <CampaignsWorkspace
      overrides={{ advertiserId, status: "ALL" }}
      show={{ account: false }}
      header={({ apiQuery }) => (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link className="underline" href={`/accounts?${back}`}>
              ← Accounts
            </Link>
            <span>
              Ad account <Mono>{advertiserId}</Mono>
            </span>
          </div>
          <AccountApps apiQuery={apiQuery} />
        </>
      )}
    />
  );
}

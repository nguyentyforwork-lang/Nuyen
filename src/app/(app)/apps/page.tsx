"use client";

import { AppsTable } from "@/components/apps-table";
import { ExportMenu } from "@/components/campaigns-workspace";
import { ErrorBox, Notices } from "@/components/common";
import { FilterBar } from "@/components/filter-bar";
import { Button, Card, Empty } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useFilters } from "@/hooks/use-filters";
import type { AppRow, DataNotice } from "@/types";

interface Resp {
  rangeLabel: string;
  items: AppRow[];
  total: number;
  page: number;
  totalPages: number;
  notices: DataNotice[];
  lastUpdated: string;
}

/** "Show all apps currently running in a Business Center / Ad Account." */
export default function AppsPage() {
  // Status filter drives the list: Active (default) = currently running apps.
  const { filters, set, apiQuery } = useFilters();
  const { data, error, loading, reload } = useApi<Resp>(filters.bcId ? `/api/apps?${apiQuery}` : null);
  const running = filters.status === "ACTIVE";

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={filters}
        set={set}
        show={{ app: false, runningApps: false, minCreativeSpend: true }}
        rangeLabel={data?.rangeLabel}
        lastUpdated={data?.lastUpdated}
        loading={loading}
        onRefresh={() => reload(true)}
      />
      {!filters.bcId && (
        <Card>
          <Empty>Select a Business Center to see all apps currently running under it.</Empty>
        </Card>
      )}
      <ErrorBox error={error} onRetry={() => reload()} />
      {data && (
        <>
          <Notices notices={data.notices} />
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold">
              {running ? "All currently running apps" : filters.status === "ALL" ? "All apps" : `Apps with ${filters.status.toLowerCase().replace("_", " ")} campaigns`} under BC <span className="font-mono">{filters.bcId}</span>
              {filters.advertiserId && (
                <>
                  {" "}
                  / account <span className="font-mono">{filters.advertiserId}</span>
                </>
              )}{" "}
              <span className="font-normal text-muted">· {data.total}</span>
            </h1>
            <ExportMenu query={apiQuery} selected={[]} />
          </div>
          <p className="text-xs text-muted">
            Running = at least one campaign with TikTok status <code>CAMPAIGN_STATUS_ENABLE</code> (not decided from spend). Apps are derived from campaign <code>app_id</code> (or the ad groups&apos; <code>app_id</code>), named via TikTok&apos;s app list.
          </p>
          <AppsTable apps={data.items} rangeLabel={data.rangeLabel} carry={apiQuery} loading={loading} />
          <div className="flex justify-end gap-1 text-xs text-muted">
            <span className="mr-2 self-center">
              page {data.page} of {data.totalPages}
            </span>
            <Button size="sm" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) }, { resetPage: false })}>
              Prev
            </Button>
            <Button size="sm" disabled={data.page >= data.totalPages} onClick={() => set({ page: String(data.page + 1) }, { resetPage: false })}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

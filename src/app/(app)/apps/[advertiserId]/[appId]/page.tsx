"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { CampaignsWorkspace } from "@/components/campaigns-workspace";
import { Mono } from "@/components/common";

/** App Overview: every campaign of one app in one ad account (default: active campaigns). */
export default function AppOverviewPage() {
  const { advertiserId, appId } = useParams<{ advertiserId: string; appId: string }>();
  const sp = useSearchParams();
  const back = new URLSearchParams(sp);
  back.delete("appId");
  back.delete("advertiserId");
  return (
    <CampaignsWorkspace
      overrides={{ advertiserId, appId }}
      show={{ account: false, app: false }}
      header={() => (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Link className="underline" href={`/apps?${back}`}>
            ← Apps
          </Link>
          <span>
            App Overview · App <Mono>{appId}</Mono> · Ad account <Mono>{advertiserId}</Mono>
          </span>
        </div>
      )}
    />
  );
}

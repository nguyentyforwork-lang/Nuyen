"use client";

import { CampaignsWorkspace } from "@/components/campaigns-workspace";
import { SuggestionsPanel } from "@/components/suggestions-panel";

/** Overview: KPIs, rule suggestions (recommendation only) and the main campaign table. */
export default function OverviewPage() {
  return (
    <CampaignsWorkspace
      header={({ filters, apiQuery, startAction }) => <SuggestionsPanel filters={filters} apiQuery={apiQuery} onReview={startAction} />}
    />
  );
}

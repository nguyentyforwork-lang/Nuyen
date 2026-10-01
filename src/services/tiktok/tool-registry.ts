import type { DiscoveredTool } from "./mcp-client";

/**
 * Features the app needs → the MCP tool that serves each one. Tool names were
 * verified against the live TikTok MCP server (see docs/MCP_TOOL_MAPPING.md). At runtime
 * each one is checked against `tools/list`; a missing tool marks the feature unavailable
 * rather than falling back to anything invented.
 */
export const CAPABILITIES = {
  listBusinessCenters: { tool: "bc_get", kind: "read", params: ["page", "page_size"] },
  listBcAdAccounts: { tool: "bc_asset_get", kind: "read", params: ["bc_id", "asset_type"] },
  advertiserInfo: { tool: "advertiser_info_get", kind: "read", params: ["advertiser_ids", "fields"] },
  listCampaigns: { tool: "campaign_get", kind: "read", params: ["advertiser_id", "fields", "filtering"] },
  listSmartPlusCampaigns: { tool: "smart_plus_campaign_get", kind: "read", params: ["advertiser_id", "filtering"] },
  listApps: { tool: "app_list_get", kind: "read", params: ["advertiser_id"] },
  listAdGroups: { tool: "adgroup_get", kind: "read", params: ["advertiser_id", "filtering", "fields"] },
  report: { tool: "report_integrated_get", kind: "read", params: ["report_type", "dimensions", "metrics"] },
  updateCampaignBudget: { tool: "campaign_update", kind: "write", params: ["advertiser_id", "campaign_id", "budget"] },
  updateSmartPlusCampaignBudget: {
    tool: "smart_plus_campaign_update",
    kind: "write",
    params: ["advertiser_id", "campaign_id", "budget"],
  },
  updateCampaignStatus: {
    tool: "campaign_status_update",
    kind: "write",
    params: ["advertiser_id", "campaign_ids", "operation_status"],
  },
  updateSmartPlusCampaignStatus: {
    tool: "smart_plus_campaign_status_update",
    kind: "write",
    params: ["advertiser_id", "campaign_ids", "operation_status"],
  },
} as const satisfies Record<string, { tool: string; kind: "read" | "write"; params: readonly string[] }>;

export type Capability = keyof typeof CAPABILITIES;

export interface CapabilityStatus {
  capability: Capability;
  tool: string;
  kind: "read" | "write";
  available: boolean;
  missingParams: string[];
  description?: string;
}

export function evaluateCapabilities(tools: Map<string, DiscoveredTool>): CapabilityStatus[] {
  return (Object.keys(CAPABILITIES) as Capability[]).map((capability) => {
    const spec = CAPABILITIES[capability];
    const tool = tools.get(spec.tool);
    const props = Object.keys(tool?.inputSchema.properties ?? {});
    return {
      capability,
      tool: spec.tool,
      kind: spec.kind,
      available: !!tool && spec.params.every((p) => props.includes(p)),
      missingParams: tool ? spec.params.filter((p) => !props.includes(p)) : [...spec.params],
      description: tool?.description?.slice(0, 240),
    };
  });
}

export function toolFor(capability: Capability): string {
  return CAPABILITIES[capability].tool;
}

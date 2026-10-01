import "server-only";
import { inBudgetLockWindow, ymdInZone } from "@/lib/dates";
import { TikTokMcpError } from "../errors";
import { getTikTokService, type TikTokMCPService } from "../reporting/service";
import { toolFor } from "../tool-registry";
import type { AccountContext, CampaignGateway, LiveCampaign } from "./engine";

/**
 * The ONLY module that calls TikTok write tools. It is reached exclusively through
 * ActionEngine.confirm(), which runs after the operator's explicit confirmation.
 */
export class TikTokCampaignGateway implements CampaignGateway {
  constructor(private readonly svc: TikTokMCPService = getTikTokService()) {}

  async readCampaigns(advertiserId: string, campaignIds: string[]): Promise<LiveCampaign[]> {
    const out: LiveCampaign[] = [];
    for (let i = 0; i < campaignIds.length; i += 100) {
      const raw = await this.svc.fetchCampaigns(advertiserId, campaignIds.slice(i, i + 100));
      out.push(
        ...raw.map((c) => ({
          campaignId: c.campaign_id,
          campaignName: c.campaign_name,
          budget: c.budget_mode === "BUDGET_MODE_INFINITE" ? null : Number(c.budget),
          budgetMode: c.budget_mode,
          operationStatus: c.operation_status,
          secondaryStatus: c.secondary_status,
          automationType: c.campaign_automation_type ?? "MANUAL",
        })),
      );
    }
    return out;
  }

  async accountContext(advertiserId: string): Promise<AccountContext> {
    const env = await this.svc.client.call<{ list: Array<{ advertiser_id: string; timezone: string; currency: string }> }>(
      toolFor("advertiserInfo"),
      { advertiser_ids: [advertiserId], fields: ["advertiser_id", "timezone", "currency"] },
    );
    const info = env.data.list?.[0];
    if (!info?.timezone) throw new TikTokMcpError("TIKTOK_API", `Could not read time zone for ad account ${advertiserId}`);
    return { advertiserId, timezone: info.timezone, currency: info.currency ?? null };
  }

  async todaySpend(advertiserId: string, campaignIds: string[], timezone: string) {
    const today = ymdInZone(new Date(), timezone);
    try {
      const env = await this.svc.client.call<{ list: Array<{ dimensions: { campaign_id: string }; metrics: { spend: string } }> }>(
        toolFor("report"),
        {
          report_type: "BASIC",
          advertiser_id: advertiserId,
          data_level: "AUCTION_CAMPAIGN",
          dimensions: ["campaign_id"],
          metrics: ["spend"],
          start_date: today,
          end_date: today,
          filtering: [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(campaignIds) }],
          page_size: 1000,
        },
      );
      return new Map((env.data.list ?? []).map((r) => [r.dimensions.campaign_id, Number.parseFloat(r.metrics.spend) || 0]));
    } catch (e) {
      if (e instanceof TikTokMcpError && e.kind === "RATE_LIMIT") throw e;
      return null;
    }
  }

  inLockWindow(timezone: string) {
    return inBudgetLockWindow(timezone);
  }

  budgetTool(c: LiveCampaign) {
    return c.automationType === "UPGRADED_SMART_PLUS" ? toolFor("updateSmartPlusCampaignBudget") : toolFor("updateCampaignBudget");
  }

  statusTool(c: LiveCampaign) {
    return c.automationType === "UPGRADED_SMART_PLUS" ? toolFor("updateSmartPlusCampaignStatus") : toolFor("updateCampaignStatus");
  }

  async updateBudget(c: LiveCampaign, advertiserId: string, budget: number) {
    const tool = this.budgetTool(c);
    const request = { advertiser_id: advertiserId, campaign_id: c.campaignId, budget };
    const env = await this.svc.client.call(tool, request);
    return { tool, request, response: env };
  }

  async updateStatus(c: LiveCampaign, advertiserId: string, status: "ENABLE" | "DISABLE") {
    const tool = this.statusTool(c);
    const request = { advertiser_id: advertiserId, campaign_ids: [c.campaignId], operation_status: status };
    const env = await this.svc.client.call<{ campaign_ids?: string[] }>(tool, request);
    return { tool, request, response: env };
  }

  invalidate(advertiserId: string) {
    this.svc.invalidateAdvertiser(advertiserId);
  }
}

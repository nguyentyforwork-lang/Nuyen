import "server-only";
import { getAppConfig } from "@/lib/config";
import { PgActionStore } from "@/db/repo";
import { ActionEngine } from "./engine";
import { TikTokCampaignGateway } from "./gateway";

let engine: ActionEngine | null = null;

export function getActionEngine(): ActionEngine {
  if (!engine) {
    const cfg = getAppConfig();
    engine = new ActionEngine(new TikTokCampaignGateway(), new PgActionStore(), {
      limits: { maxIncreasePct: cfg.APP_MAX_BUDGET_INCREASE_PCT, maxDecreasePct: cfg.APP_MAX_BUDGET_DECREASE_PCT },
      pendingTtlSeconds: cfg.APP_PENDING_ACTION_TTL_SECONDS,
    });
  }
  return engine;
}

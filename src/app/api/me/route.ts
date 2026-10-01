import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { handle, requireOperator } from "@/lib/http";

export const GET = handle(async (req) => {
  const operator = requireOperator(req);
  const cfg = getAppConfig();
  return NextResponse.json({
    operator,
    authMode: cfg.APP_AUTH_MODE,
    settings: {
      timezone: cfg.APP_TIMEZONE,
      defaultMinCreativeSpend: cfg.APP_DEFAULT_MIN_CREATIVE_SPEND,
      maxIncreasePct: cfg.APP_MAX_BUDGET_INCREASE_PCT,
      maxDecreasePct: cfg.APP_MAX_BUDGET_DECREASE_PCT,
      cacheTtlSeconds: cfg.APP_CACHE_TTL_SECONDS,
    },
  });
});

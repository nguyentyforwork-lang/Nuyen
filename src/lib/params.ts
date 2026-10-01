import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { DATE_PRESETS, STATUS_FILTERS } from "@/types";
import { getAppConfig } from "./config";
import { rangeLabel, resolveDateRange } from "./dates";

const id = z.string().regex(/^\d{1,32}$/, "must be a numeric TikTok ID");

const schema = z.object({
  bcId: id,
  advertiserId: id.optional(),
  appId: z.string().max(64).optional(),
  status: z.enum(STATUS_FILTERS).default("ACTIVE"),
  preset: z.enum(DATE_PRESETS).default("yesterday"),
  start: z.string().optional(),
  end: z.string().optional(),
  q: z.string().max(200).optional(),
  runningApps: z.enum(["1", "0", "true", "false"]).optional(),
  minCreativeSpend: z.coerce.number().min(0).max(1_000_000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.string().max(32).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  refresh: z.enum(["1", "0"]).optional(),
  campaignIds: z.string().max(20_000).optional(),
});

export function parseDatasetParams(req: NextRequest) {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  for (const k of Object.keys(raw)) if (raw[k] === "") delete raw[k];
  const p = schema.parse(raw);
  const range = resolveDateRange(p.preset, getAppConfig().APP_TIMEZONE, { start: p.start, end: p.end });
  return {
    ...p,
    range,
    rangeLabel: rangeLabel(range),
    runningAppsOnly: p.runningApps === "1" || p.runningApps === "true",
    force: p.refresh === "1",
    campaignIds: p.campaignIds ? p.campaignIds.split(",").filter((s) => /^\d+$/.test(s)) : null,
  };
}

export const tiktokId = id;

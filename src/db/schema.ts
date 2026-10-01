import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Only data the agency must own is persisted: the audit trail, pending confirmations,
 * rules and dismissals. TikTok reporting data is not stored permanently. It lives in the
 * short-TTL in-process cache only.
 */

/** Immutable audit trail of every write attempt. Never updated except to record its outcome. */
export const actionLogs = pgTable(
  "action_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    operator: text("operator").notNull(),
    bcId: text("bc_id"),
    advertiserId: text("advertiser_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name").notNull(),
    actionType: text("action_type").notNull(), // BUDGET_INCREASE | BUDGET_DECREASE | TURN_ON | TURN_OFF
    beforeValue: text("before_value").notNull(),
    afterValue: text("after_value").notNull(), // the requested value
    verifiedValue: text("verified_value"), // the value TikTok returned after execution
    currency: text("currency"),
    status: text("status").notNull(), // EXECUTING | SUCCESS | FAILED | VERIFICATION_FAILED
    errorMessage: text("error_message"),
    mcpTool: text("mcp_tool").notNull(),
    mcpRequest: jsonb("mcp_request").notNull(),
    mcpResponse: jsonb("mcp_response"),
    source: text("source").notNull().default("MANUAL"), // MANUAL | BULK | RULE_SUGGESTION
    batchId: uuid("batch_id"),
    pendingActionId: uuid("pending_action_id"),
    ruleId: uuid("rule_id"),
    limitOverride: boolean("limit_override").notNull().default(false),
  },
  (t) => [
    index("action_logs_created_idx").on(t.createdAt),
    index("action_logs_campaign_idx").on(t.advertiserId, t.campaignId),
  ],
);

/** A reviewed-but-not-yet-confirmed write. Single use: PENDING → EXECUTING → DONE. */
export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  operator: text("operator").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | EXECUTING | DONE | CANCELLED
  source: text("source").notNull().default("MANUAL"),
  ruleId: uuid("rule_id"),
  requiresLimitOverride: boolean("requires_limit_override").notNull().default(false),
  /** Full reviewed plan: targets, current values, proposed values. */
  plan: jsonb("plan").notNull(),
});

export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Always RECOMMEND_ONLY. Automatic execution is intentionally not implemented. */
  mode: text("mode").notNull().default("RECOMMEND_ONLY"),
  conditions: jsonb("conditions").notNull(),
  action: text("action").notNull(), // DECREASE_BUDGET | INCREASE_BUDGET | TURN_OFF | TURN_ON
  actionValue: numeric("action_value"),
  bcId: text("bc_id"),
  advertiserId: text("advertiser_id"),
});

export const ruleDismissals = pgTable(
  "rule_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ruleId: uuid("rule_id").notNull(),
    advertiserId: text("advertiser_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    rangeKey: text("range_key").notNull(),
    dismissedBy: text("dismissed_by").notNull(),
  },
  (t) => [index("rule_dismissals_lookup_idx").on(t.ruleId, t.campaignId, t.rangeKey)],
);

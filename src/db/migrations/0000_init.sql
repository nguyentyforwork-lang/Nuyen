CREATE TABLE "action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"operator" text NOT NULL,
	"bc_id" text,
	"advertiser_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"action_type" text NOT NULL,
	"before_value" text NOT NULL,
	"after_value" text NOT NULL,
	"verified_value" text,
	"currency" text,
	"status" text NOT NULL,
	"error_message" text,
	"mcp_tool" text NOT NULL,
	"mcp_request" jsonb NOT NULL,
	"mcp_response" jsonb,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"batch_id" uuid,
	"pending_action_id" uuid,
	"rule_id" uuid,
	"limit_override" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"operator" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"rule_id" uuid,
	"requires_limit_override" boolean DEFAULT false NOT NULL,
	"plan" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rule_id" uuid NOT NULL,
	"advertiser_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"range_key" text NOT NULL,
	"dismissed_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'RECOMMEND_ONLY' NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" text NOT NULL,
	"action_value" numeric,
	"bc_id" text,
	"advertiser_id" text
);
--> statement-breakpoint
CREATE INDEX "action_logs_created_idx" ON "action_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "action_logs_campaign_idx" ON "action_logs" USING btree ("advertiser_id","campaign_id");--> statement-breakpoint
CREATE INDEX "rule_dismissals_lookup_idx" ON "rule_dismissals" USING btree ("rule_id","campaign_id","range_key");--> statement-breakpoint
-- Audit trail is append-only: rows cannot be deleted, and only the outcome of an
-- EXECUTING row may be recorded (once). Everything else about an action is immutable.
CREATE OR REPLACE FUNCTION action_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'action_logs is append-only';
  END IF;
  IF OLD.status <> 'EXECUTING'
     OR NEW.operator IS DISTINCT FROM OLD.operator
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.advertiser_id IS DISTINCT FROM OLD.advertiser_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.action_type IS DISTINCT FROM OLD.action_type
     OR NEW.before_value IS DISTINCT FROM OLD.before_value
     OR NEW.after_value IS DISTINCT FROM OLD.after_value
     OR NEW.mcp_tool IS DISTINCT FROM OLD.mcp_tool
     OR NEW.mcp_request IS DISTINCT FROM OLD.mcp_request THEN
    RAISE EXCEPTION 'action_logs rows are immutable once completed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER action_logs_guard BEFORE UPDATE OR DELETE ON action_logs FOR EACH ROW EXECUTE FUNCTION action_logs_guard();

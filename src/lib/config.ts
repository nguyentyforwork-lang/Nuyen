import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Split into three independent sections so MCP credentials,
 * database credentials and application settings never get mixed. Nothing here is
 * ever sent to the browser (the `server-only` import enforces that at build time).
 */

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const mcpSchema = z.object({
  TIKTOK_MCP_URL: z.string().url(),
  /** Header carrying the TikTok MCP credential, e.g. "Authorization" or "Access-Token". */
  TIKTOK_MCP_AUTH_HEADER: z.string().default("Authorization"),
  /** Full header value, e.g. "Bearer abc…". */
  TIKTOK_MCP_AUTH_TOKEN: z.string().min(1),
  /** Optional JSON object of extra headers required by the MCP endpoint. */
  TIKTOK_MCP_EXTRA_HEADERS: z.string().optional(),
  TIKTOK_MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  TIKTOK_MCP_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  /** Report metric holding D0 IAA revenue, if TikTok exposes one. Validated at runtime. */
  TIKTOK_IAA_D0_REVENUE_METRIC: z.string().optional(),
  /** Official D0 IAA ROAS metric, if TikTok exposes one. Validated at runtime. */
  TIKTOK_IAA_D0_ROAS_METRIC: z.string().optional(),
  /** How the official ROAS metric is scaled: 1.05 ("ratio") or 105 ("percent"). */
  TIKTOK_IAA_D0_ROAS_SCALE: z.enum(["ratio", "percent"]).default("ratio"),
});

const dbSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

const appSchema = z.object({
  APP_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh"),
  APP_CACHE_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(90),
  APP_MIN_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(15),
  APP_MAX_BUDGET_INCREASE_PCT: z.coerce.number().positive().default(50),
  APP_MAX_BUDGET_DECREASE_PCT: z.coerce.number().positive().max(100).default(50),
  APP_DEFAULT_MIN_CREATIVE_SPEND: z.coerce.number().min(0).default(20),
  APP_PENDING_ACTION_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  /** "password": built-in login against APP_USERS. "proxy_header": trust an SSO proxy header. */
  APP_AUTH_MODE: z.enum(["password", "proxy_header"]).default("password"),
  APP_AUTH_PROXY_HEADER: z.string().default("x-forwarded-email"),
  /** Comma-separated "username:scrypt.<salt>.<hash>" entries (see scripts/hash-password.ts). */
  APP_USERS: z.string().optional(),
  APP_SESSION_SECRET: z.string().min(32).optional(),
  APP_SECURE_COOKIES: bool,
});

export type McpConfig = z.infer<typeof mcpSchema>;
export type DbConfig = z.infer<typeof dbSchema>;
export type AppConfig = z.infer<typeof appSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, section: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`${section} configuration is invalid: ${issues}`);
  }
  return result.data;
}

export class ConfigError extends Error {
  readonly code = "CONFIG_ERROR";
}

let mcp: McpConfig | undefined;
let db: DbConfig | undefined;
let app: AppConfig | undefined;

export const getMcpConfig = () => (mcp ??= parse(mcpSchema, "MCP"));
export const getDbConfig = () => (db ??= parse(dbSchema, "Database"));
export const getAppConfig = (): AppConfig => {
  if (!app) {
    app = parse(appSchema, "Application");
    if (app.APP_AUTH_MODE === "password" && (!app.APP_USERS || !app.APP_SESSION_SECRET)) {
      throw new ConfigError(
        "Application configuration is invalid: APP_USERS and APP_SESSION_SECRET (≥32 chars) are required when APP_AUTH_MODE=password",
      );
    }
  }
  return app;
};

/** Safe, non-secret view of configuration for the status page. */
export function describeConfig() {
  const safe = (fn: () => unknown) => {
    try {
      fn();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  };
  return {
    mcp: safe(getMcpConfig),
    db: safe(getDbConfig),
    app: safe(getAppConfig),
  };
}

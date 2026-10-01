/** Error categories surfaced to the UI. Errors are never swallowed or downgraded to success. */
export type TikTokErrorKind =
  | "RATE_LIMIT"
  | "AUTH"
  | "TOOL_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "TIKTOK_API"
  | "TRANSPORT"
  | "VERIFICATION";

export class TikTokMcpError extends Error {
  constructor(
    readonly kind: TikTokErrorKind,
    message: string,
    readonly details: {
      tool?: string;
      tiktokCode?: number;
      requestId?: string;
      raw?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "TikTokMcpError";
  }

  /** Message shown to operators. */
  get userMessage(): string {
    if (this.kind === "RATE_LIMIT") return "TikTok API/MCP rate limit reached. Please retry later.";
    return this.message;
  }
}

/** TikTok Business API codes that mean throttling (40100: "Requests made too frequently"). */
const RATE_LIMIT_CODES = new Set([40100, 40133]);
const AUTH_CODES = new Set([40001, 40102, 40104, 40105]);

export function classifyTikTokCode(code: number, message: string): TikTokErrorKind {
  if (RATE_LIMIT_CODES.has(code) || /rate limit|too many requests|too frequent|qps/i.test(message)) {
    return "RATE_LIMIT";
  }
  if (AUTH_CODES.has(code) || /access token|permission|unauthori[sz]ed/i.test(message)) return "AUTH";
  if (code >= 40000 && code < 50000) return "INVALID_REQUEST";
  return "TIKTOK_API";
}

export function toErrorPayload(err: unknown) {
  if (err instanceof TikTokMcpError) {
    return {
      kind: err.kind,
      message: err.userMessage,
      tool: err.details.tool,
      tiktokCode: err.details.tiktokCode,
      requestId: err.details.requestId,
    };
  }
  const e = err as Error & { code?: string };
  return { kind: e?.code ?? "INTERNAL", message: e?.message ?? String(err) };
}

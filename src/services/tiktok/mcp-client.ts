import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getMcpConfig } from "@/lib/config";
import { Semaphore } from "@/lib/semaphore";
import { TikTokMcpError, classifyTikTokCode } from "./errors";

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
}

/** Shape of every TikTok Business API response relayed by the MCP server. */
export interface TikTokEnvelope<T = unknown> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

/**
 * Thin, server-only wrapper around the official TikTok for Business MCP server.
 * - Tools are discovered with `tools/list`. Nothing is called that was not discovered.
 * - Concurrency is capped so the dashboard does not hammer TikTok.
 * - TikTok's `{code, message, data}` envelope is unwrapped; any non-zero code throws.
 */
export interface McpTransportLike {
  listTools(): Promise<DiscoveredTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

class SdkTransport implements McpTransportLike {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    const cfg = getMcpConfig();
    const headers: Record<string, string> = { [cfg.TIKTOK_MCP_AUTH_HEADER]: cfg.TIKTOK_MCP_AUTH_TOKEN };
    if (cfg.TIKTOK_MCP_EXTRA_HEADERS) Object.assign(headers, JSON.parse(cfg.TIKTOK_MCP_EXTRA_HEADERS));
    this.connecting = (async () => {
      const client = new Client({ name: "tiktok-ads-control-center", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(cfg.TIKTOK_MCP_URL), {
        requestInit: { headers },
      });
      try {
        await client.connect(transport);
      } catch (e) {
        throw new TikTokMcpError("TRANSPORT", `Could not connect to TikTok MCP server: ${(e as Error).message}`);
      }
      transport.onclose = () => {
        this.client = null;
      };
      this.client = client;
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async listTools(): Promise<DiscoveredTool[]> {
    const client = await this.connect();
    const tools: DiscoveredTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...(page.tools as DiscoveredTool[]));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect();
    const cfg = getMcpConfig();
    try {
      return await client.callTool({ name, arguments: args }, undefined, { timeout: cfg.TIKTOK_MCP_TIMEOUT_MS });
    } catch (e) {
      this.client = null; // force reconnect next time
      throw new TikTokMcpError("TRANSPORT", `MCP call ${name} failed: ${(e as Error).message}`, { tool: name });
    }
  }
}

/** Extracts the TikTok envelope from an MCP tool result (text content containing JSON). */
export function parseToolResult<T>(tool: string, result: unknown): TikTokEnvelope<T> {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown };
  const text = r?.content?.find((c) => c.type === "text")?.text;
  if (r?.isError) {
    throw new TikTokMcpError("TIKTOK_API", text?.slice(0, 500) || `Tool ${tool} returned an error`, { tool, raw: result });
  }
  let body: unknown = r?.structuredContent;
  if (body === undefined && text !== undefined) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new TikTokMcpError("TIKTOK_API", `Tool ${tool} returned non-JSON content: ${text.slice(0, 200)}`, { tool });
    }
  }
  const env = body as TikTokEnvelope<T>;
  if (!env || typeof env.code !== "number") {
    throw new TikTokMcpError("TIKTOK_API", `Tool ${tool} returned an unexpected payload`, { tool, raw: body });
  }
  if (env.code !== 0) {
    throw new TikTokMcpError(classifyTikTokCode(env.code, env.message), `TikTok error ${env.code}: ${env.message}`, {
      tool,
      tiktokCode: env.code,
      requestId: env.request_id,
      raw: env,
    });
  }
  return env;
}

export class TikTokMcpClient {
  private tools: Map<string, DiscoveredTool> | null = null;
  private discovering: Promise<Map<string, DiscoveredTool>> | null = null;
  private discoveredAt: Date | null = null;
  private readonly sem: Semaphore;

  constructor(
    private readonly transport: McpTransportLike,
    concurrency: number,
  ) {
    this.sem = new Semaphore(concurrency);
  }

  async discover(force = false): Promise<Map<string, DiscoveredTool>> {
    if (this.tools && !force) return this.tools;
    this.discovering ??= this.transport
      .listTools()
      .then((list) => {
        this.tools = new Map(list.map((t) => [t.name, t]));
        this.discoveredAt = new Date();
        return this.tools;
      })
      .finally(() => {
        this.discovering = null;
      });
    return this.discovering;
  }

  get lastDiscoveredAt() {
    return this.discoveredAt;
  }

  /** Calls a discovered tool and returns the unwrapped TikTok `data` envelope. */
  async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<TikTokEnvelope<T>> {
    const tools = await this.discover();
    const tool = tools.get(name);
    if (!tool) {
      throw new TikTokMcpError("TOOL_UNAVAILABLE", `MCP tool "${name}" is not exposed by the connected TikTok MCP server`, {
        tool: name,
      });
    }
    const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined);
    if (missing.length) {
      throw new TikTokMcpError("INVALID_REQUEST", `Missing required parameter(s) for ${name}: ${missing.join(", ")}`, {
        tool: name,
      });
    }
    return this.sem.run(async () => parseToolResult<T>(name, await this.transport.callTool(name, args)));
  }
}

let singleton: TikTokMcpClient | null = null;
export function getMcpClient(): TikTokMcpClient {
  if (!singleton) {
    const cfg = getMcpConfig();
    singleton = new TikTokMcpClient(new SdkTransport(), cfg.TIKTOK_MCP_MAX_CONCURRENCY);
  }
  return singleton;
}

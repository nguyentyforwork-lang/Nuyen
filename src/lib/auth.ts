import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getAppConfig } from "./config";

export const SESSION_COOKIE = "tacc_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** "scrypt.<salt hex>.<hash hex>" (no "$", so dotenv variable expansion cannot corrupt it). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt.${salt.toString("hex")}.${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(".");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function users(): Map<string, string> {
  const raw = getAppConfig().APP_USERS ?? "";
  return new Map(
    raw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => {
        const i = e.indexOf(":");
        return [e.slice(0, i), e.slice(i + 1)] as [string, string];
      }),
  );
}

export function checkCredentials(username: string, password: string): boolean {
  const stored = users().get(username);
  if (!stored) {
    // Constant-ish time for unknown users.
    verifyPassword(password, "scrypt.00000000000000000000000000000000." + "0".repeat(128));
    return false;
  }
  return verifyPassword(password, stored);
}

const sign = (payload: string) => createHmac("sha256", getAppConfig().APP_SESSION_SECRET!).update(payload).digest("base64url");

export function createSessionToken(username: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: now + SESSION_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u !== "string" || typeof exp !== "number" || exp < now) return null;
    if (!users().has(u)) return null; // removed users lose access immediately
    return u;
  } catch {
    return null;
  }
}

/** Resolves the operator for a request, or null if unauthenticated. */
export function operatorFromRequest(req: { headers: Headers; cookies: { get(name: string): { value: string } | undefined } }): string | null {
  const cfg = getAppConfig();
  if (cfg.APP_AUTH_MODE === "proxy_header") {
    const v = req.headers.get(cfg.APP_AUTH_PROXY_HEADER)?.trim();
    return v || null;
  }
  return readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export const sessionTtlSeconds = SESSION_TTL_MS / 1000;

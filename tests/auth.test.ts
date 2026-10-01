import { beforeAll, describe, expect, it, vi } from "vitest";

describe("auth", () => {
  let auth: typeof import("@/lib/auth");
  beforeAll(async () => {
    // Build the user entry first, then load config with it.
    const { hashPassword } = await import("@/lib/auth");
    vi.stubEnv("APP_USERS", `nguyen:${hashPassword("s3cret!")}`);
    vi.stubEnv("APP_SESSION_SECRET", "x".repeat(40));
    vi.resetModules();
    auth = await import("@/lib/auth");
  });

  it("verifies scrypt passwords (dotenv-safe format, no '$')", () => {
    expect(auth.hashPassword("a")).toMatch(/^scrypt\.[0-9a-f]{32}\.[0-9a-f]{128}$/);
    expect(auth.checkCredentials("nguyen", "s3cret!")).toBe(true);
    expect(auth.checkCredentials("nguyen", "wrong")).toBe(false);
    expect(auth.checkCredentials("nobody", "s3cret!")).toBe(false);
  });

  it("session tokens are signed and expire", () => {
    const t = auth.createSessionToken("nguyen", 1_000);
    expect(auth.readSessionToken(t, 2_000)).toBe("nguyen");
    expect(auth.readSessionToken(t, 1_000 + 13 * 3600_000)).toBeNull();
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "admin", exp: 9e15 })).toString("base64url");
    expect(auth.readSessionToken(`${forged}.${sig}`, 2_000)).toBeNull();
    expect(auth.readSessionToken(`${payload}.x${sig.slice(1)}`, 2_000)).toBeNull();
  });
});

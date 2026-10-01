import type { Maybe, MoneyByCurrency } from "@/types";

export const IAA_NA = "N/A — metric unavailable from current TikTok MCP reporting";

export function money(n: number | null | undefined, currency?: string | null, opts: { compact?: boolean } = {}) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const digits = currency === "VND" || currency === "JPY" || currency === "KRW" ? 0 : 2;
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: opts.compact ? 0 : digits,
    maximumFractionDigits: digits,
    ...(opts.compact && Math.abs(n) >= 100_000 ? { notation: "compact" } : {}),
  });
  if (currency === "USD") return `$${body}`;
  return currency ? `${body} ${currency}` : body;
}

export function moneyByCurrency(m: MoneyByCurrency) {
  const entries = Object.entries(m).filter(([, v]) => v !== 0);
  if (!entries.length) return money(0, Object.keys(m)[0] ?? "USD");
  return entries.map(([c, v]) => money(v, c, { compact: true })).join(" · ");
}

export function pct(m: Maybe<number>) {
  return m.ok ? `${m.value.toFixed(1)}%` : "N/A";
}

export function int(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function time(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateTime(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-CA")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

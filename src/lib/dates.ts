import type { DatePreset, DateRange } from "@/types";

/** YYYY-MM-DD for `date` as seen in IANA `timeZone`. */
export function ymdInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function resolveDateRange(
  preset: DatePreset,
  timeZone: string,
  custom?: { start?: string | null; end?: string | null },
  now = new Date(),
): DateRange {
  const today = ymdInZone(now, timeZone);
  switch (preset) {
    case "today":
      return { preset, start: today, end: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { preset, start: y, end: y };
    }
    case "last_3":
    case "last_7":
    case "last_14":
    case "last_30": {
      const n = Number(preset.split("_")[1]);
      // "Last N days" = the N complete days ending yesterday (TikTok Ads Manager convention).
      return { preset, start: addDays(today, -n), end: addDays(today, -1) };
    }
    case "custom": {
      const start = custom?.start ?? "";
      const end = custom?.end ?? "";
      if (!YMD.test(start) || !YMD.test(end)) throw new RangeError("Custom range needs start and end as YYYY-MM-DD");
      if (start > end) throw new RangeError("Custom range start must be on or before end");
      if (daysBetween(start, end) > 364) throw new RangeError("Custom range cannot exceed 365 days");
      if (end > today) throw new RangeError("Custom range cannot end in the future");
      return { preset, start, end };
    }
  }
}

const fmt = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Human label used next to every metric, e.g. "Sep 30, 2026" or "Sep 24 – Sep 30, 2026". */
export function rangeLabel(range: Pick<DateRange, "start" | "end">): string {
  if (range.start === range.end) return fmt(range.start);
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  const startLabel = sameYear
    ? new Date(`${range.start}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : fmt(range.start);
  return `${startLabel} – ${fmt(range.end)}`;
}

export function includesToday(range: Pick<DateRange, "end">, timeZone: string, now = new Date()) {
  return range.end >= ymdInZone(now, timeZone);
}

/** Minutes since local midnight in `timeZone`. */
export function minutesOfDay(timeZone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

/** TikTok rejects budget changes 23:55–00:00 in the ad account's time zone. */
export function inBudgetLockWindow(timeZone: string, now = new Date()) {
  return minutesOfDay(timeZone, now) >= 23 * 60 + 55;
}

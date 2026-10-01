// Date-range helpers. Every range is resolved in the *ad account's* time zone,
// because TikTok reports (start_date / end_date / stat_time_day) use it.

function isValidTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// YYYY-MM-DD of "now" in the given IANA time zone.
function todayIn(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTz(tz) ? tz : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

const PRESETS = ['today', 'yesterday', 'last3', 'last7', 'last14', 'last30', 'custom'];

// preset: today | yesterday | lastN | custom. includeToday applies to lastN.
function resolveRange({ preset = 'today', start, end, includeToday = false }, tz, now) {
  const today = todayIn(tz, now);
  if (preset === 'today') return { start: today, end: today };
  if (preset === 'yesterday') {
    const y = addDays(today, -1);
    return { start: y, end: y };
  }
  const m = /^last(\d+)$/.exec(preset);
  if (m) {
    const n = Number(m[1]);
    const endD = includeToday ? today : addDays(today, -1);
    return { start: addDays(endD, -(n - 1)), end: endD };
  }
  if (preset === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    if (start > end) [start, end] = [end, start];
    if (daysBetween(start, end) > 29) start = addDays(end, -29); // stat_time_day max 30 days
    return { start, end };
  }
  return { start: today, end: today };
}

module.exports = { todayIn, addDays, daysBetween, resolveRange, isValidTz, PRESETS };

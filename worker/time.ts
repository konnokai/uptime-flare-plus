// 用 Intl 做時區換算，Workers 沒有完整的時區資料庫套件可用，也不需要
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=週日 */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(ts: number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(ts)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday!] ?? 0,
  };
}

function offsetAt(ts: number, timeZone: string): number {
  const p = zonedParts(ts, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/**
 * 某時區的牆上時間 → epoch 毫秒。
 * 夏令時間切換的空檔（例如 02:30 不存在）會落在切換後；重複的那一小時取第一次。
 */
export function zonedToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // 一天內最多切換一次，用前後 12 小時的偏移量當候選就夠
  const before = offsetAt(wall - 12 * 3_600_000, timeZone);
  const after = offsetAt(wall + 12 * 3_600_000, timeZone);
  for (const offset of [before, after]) {
    const ts = wall - offset;
    if (offsetAt(ts, timeZone) === offset) return ts;
  }
  // 落在空檔：用切換前的偏移量換算，結果剛好在切換後
  return wall - before;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function formatDay(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function dayKey(ts: number, timeZone: string): string {
  return formatDay(zonedParts(ts, timeZone));
}

/** 最近 n 天的日期字串，舊到新，最後一個是今天 */
export function lastNDays(now: number, timeZone: string, n: number): string[] {
  const today = zonedParts(now, timeZone);
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(formatDay(addDays(today, -i)));
  return days;
}

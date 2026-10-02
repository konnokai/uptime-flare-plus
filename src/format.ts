import type { DailyStat } from '../shared/types';

export const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Kind = 'datetime' | 'datetimeSec' | 'time' | 'date' | 'weekdayDatetime';

const OPTIONS: Record<Kind, Intl.DateTimeFormatOptions> = {
  datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  datetimeSec: {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  },
  time: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
  date: { year: 'numeric', month: '2-digit', day: '2-digit' },
  weekdayDatetime: {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  },
};

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: Kind, tz?: string): Intl.DateTimeFormat {
  const zone = tz && isValidTimeZone(tz) ? tz : undefined;
  const key = `${kind}|${zone ?? ''}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('zh-TW', { ...OPTIONS[kind], timeZone: zone });
    cache.set(key, f);
  }
  return f;
}

export function formatDateTime(ms: number | null | undefined, tz?: string, withSeconds = false): string {
  if (ms == null) return '—';
  return formatter(withSeconds ? 'datetimeSec' : 'datetime', tz).format(ms);
}

export function formatTime(ms: number, tz?: string): string {
  return formatter('time', tz).format(ms);
}

export function formatDate(ms: number, tz?: string): string {
  return formatter('date', tz).format(ms);
}

export function formatWeekdayDateTime(ms: number, tz?: string): string {
  return formatter('weekdayDatetime', tz).format(ms);
}

export function formatRelative(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null) return '—';
  const diff = Math.round((now - ms) / 1000);
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3600) return `${Math.max(1, Math.round(ahead / 60))} 分鐘後`;
    if (ahead < 86400) return `${Math.round(ahead / 3600)} 小時後`;
    return `${Math.round(ahead / 86400)} 天後`;
  }
  if (diff < 45) return '剛剛';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} 分鐘前`;
  if (diff < 86400) return `${Math.round(diff / 3600)} 小時前`;
  return `${Math.round(diff / 86400)} 天前`;
}

/** ratio 是 0–1。用無條件捨去，避免 99.996% 顯示成 100% */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || Number.isNaN(ratio)) return '—';
  if (ratio >= 1) return '100%';
  const v = Math.floor(ratio * 10000) / 100;
  return `${v.toFixed(2)}%`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

export function dayUptime(d: DailyStat): number | null {
  const total = d.up + d.down;
  return total > 0 ? d.up / total : null;
}

/** 單日色階：滿分、輕微、嚴重、無資料 */
export function dayClass(d: DailyStat): string {
  const u = dayUptime(d);
  if (u == null) return 's-none';
  if (u >= 0.999) return 's-up';
  if (u >= 0.95) return 's-pending';
  return 's-down';
}

/** datetime-local 的值（瀏覽器時區）轉 epoch 毫秒 */
export function localInputToMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function msToLocalInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

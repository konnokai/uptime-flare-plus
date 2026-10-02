import { describe, expect, it } from 'vitest';
import { currentWindow, nextWindow, type MaintenanceRule } from '../worker/maintenance';
import { dayKey, lastNDays, zonedToEpoch } from '../worker/time';

const base: MaintenanceRule = {
  strategy: 'weekly',
  active: true,
  startAt: null,
  endAt: null,
  weekdays: [],
  startTime: '00:00',
  endTime: '00:00',
  timezone: 'Asia/Taipei',
};

// 2026-10-06 是週二
const taipei = (d: number, h: number, m = 0) => zonedToEpoch(2026, 10, d, h, m, 'Asia/Taipei');

describe('time helpers', () => {
  it('converts zoned wall time to epoch', () => {
    expect(taipei(6, 2)).toBe(Date.UTC(2026, 9, 5, 18, 0));
    expect(zonedToEpoch(2026, 7, 1, 12, 0, 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 16, 0));
  });

  it('maps DST gaps to after the transition and overlaps to the first occurrence', () => {
    // 紐約 2026-03-08 02:30 不存在 → 03:30 EDT
    expect(zonedToEpoch(2026, 3, 8, 2, 30, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30));
    // 雪梨 2026-10-04 02:30 不存在 → 03:30 AEDT
    expect(zonedToEpoch(2026, 10, 4, 2, 30, 'Australia/Sydney')).toBe(Date.UTC(2026, 9, 3, 16, 30));
    // 紐約 2026-11-01 01:30 出現兩次 → 取 EDT 那次
    expect(zonedToEpoch(2026, 11, 1, 1, 30, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('computes day keys in the given time zone', () => {
    const ts = Date.UTC(2026, 9, 5, 17, 0); // 台北 10/06 01:00
    expect(dayKey(ts, 'Asia/Taipei')).toBe('2026-10-06');
    expect(dayKey(ts, 'UTC')).toBe('2026-10-05');
    expect(lastNDays(ts, 'Asia/Taipei', 3)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });
});

describe('maintenance windows', () => {
  it('manual follows the active flag', () => {
    const rule = { ...base, strategy: 'manual' as const, startAt: 1000 };
    expect(currentWindow(rule, 5000)).toEqual({ start: 1000, end: null });
    expect(currentWindow({ ...rule, active: false }, 5000)).toBeNull();
  });

  it('single uses [startAt, endAt)', () => {
    const rule = { ...base, strategy: 'single' as const, startAt: 1000, endAt: 2000 };
    expect(currentWindow(rule, 999)).toBeNull();
    expect(currentWindow(rule, 1000)).toEqual({ start: 1000, end: 2000 });
    expect(currentWindow(rule, 2000)).toBeNull();
    expect(nextWindow(rule, 500)).toEqual({ start: 1000, end: 2000 });
  });

  it('weekly window on the same day', () => {
    const rule = { ...base, weekdays: [2], startTime: '02:00', endTime: '04:00' };
    expect(currentWindow(rule, taipei(6, 1, 59))).toBeNull();
    expect(currentWindow(rule, taipei(6, 3))).toEqual({ start: taipei(6, 2), end: taipei(6, 4) });
    expect(currentWindow(rule, taipei(6, 4))).toBeNull();
    expect(currentWindow(rule, taipei(7, 3))).toBeNull(); // 週三
    expect(nextWindow(rule, taipei(6, 5))).toEqual({ start: taipei(13, 2), end: taipei(13, 4) });
  });

  it('weekly window crossing midnight belongs to the start day', () => {
    // 週二 23:00 到週三 01:00
    const rule = { ...base, weekdays: [2], startTime: '23:00', endTime: '01:00' };
    expect(currentWindow(rule, taipei(6, 23, 30))).toEqual({ start: taipei(6, 23), end: taipei(7, 1) });
    expect(currentWindow(rule, taipei(7, 0, 30))).toEqual({ start: taipei(6, 23), end: taipei(7, 1) });
    expect(currentWindow(rule, taipei(7, 1))).toBeNull();
    // 週一 00:30 不算：前一天是週日
    expect(currentWindow(rule, taipei(5, 0, 30))).toBeNull();
  });

  it('weekly window respects the rule time zone', () => {
    const rule = { ...base, weekdays: [1], startTime: '09:00', endTime: '10:00', timezone: 'UTC' };
    // UTC 週一 09:30 = 台北週一 17:30
    expect(currentWindow(rule, Date.UTC(2026, 9, 5, 9, 30))).not.toBeNull();
    expect(currentWindow(rule, Date.UTC(2026, 9, 5, 1, 30))).toBeNull();
  });
});

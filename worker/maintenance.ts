import type { MaintenanceInput, MaintenanceWindow } from '../shared/types';
import { addDays, weekdayOf, zonedParts, zonedToEpoch, type CalendarDate } from './time';

export type MaintenanceRule = Pick<
  MaintenanceInput,
  'strategy' | 'active' | 'startAt' | 'endAt' | 'weekdays' | 'startTime' | 'endTime' | 'timezone'
>;

function parseHm(value: string): [number, number] {
  const [h, m] = value.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

function weeklyWindow(rule: MaintenanceRule, date: CalendarDate): MaintenanceWindow {
  const [sh, sm] = parseHm(rule.startTime);
  const [eh, em] = parseHm(rule.endTime);
  // 結束時間不晚於開始時間 = 跨午夜，結束在隔天
  const crosses = eh * 60 + em <= sh * 60 + sm;
  const endDate = crosses ? addDays(date, 1) : date;
  return {
    start: zonedToEpoch(date.year, date.month, date.day, sh, sm, rule.timezone),
    end: zonedToEpoch(endDate.year, endDate.month, endDate.day, eh, em, rule.timezone),
  };
}

/** 現在正在進行的維護時段，沒有則 null */
export function currentWindow(rule: MaintenanceRule, now: number): MaintenanceWindow | null {
  if (!rule.active) return null;
  switch (rule.strategy) {
    case 'manual':
      return { start: rule.startAt ?? now, end: null };
    case 'single':
      if (rule.startAt != null && rule.endAt != null && rule.startAt <= now && now < rule.endAt) {
        return { start: rule.startAt, end: rule.endAt };
      }
      return null;
    case 'weekly': {
      const today = zonedParts(now, rule.timezone);
      // 昨天開始、跨午夜到今天的時段也要算
      for (const offset of [0, -1]) {
        const date = addDays(today, offset);
        if (!rule.weekdays.includes(weekdayOf(date))) continue;
        const w = weeklyWindow(rule, date);
        if (w.start <= now && now < w.end!) return w;
      }
      return null;
    }
  }
}

/** 下一段還沒開始的維護時段，沒有則 null */
export function nextWindow(rule: MaintenanceRule, now: number): MaintenanceWindow | null {
  if (!rule.active) return null;
  switch (rule.strategy) {
    case 'manual':
      return null;
    case 'single':
      if (rule.startAt != null && rule.endAt != null && rule.startAt > now) {
        return { start: rule.startAt, end: rule.endAt };
      }
      return null;
    case 'weekly': {
      if (rule.weekdays.length === 0) return null;
      const today = zonedParts(now, rule.timezone);
      for (let i = 0; i <= 7; i++) {
        const date = addDays(today, i);
        if (!rule.weekdays.includes(weekdayOf(date))) continue;
        const w = weeklyWindow(rule, date);
        if (w.start > now) return w;
      }
      return null;
    }
  }
}

export function inMaintenance(rules: MaintenanceRule[], now: number): boolean {
  return rules.some((r) => currentWindow(r, now) !== null);
}

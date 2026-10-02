const COMMON = [
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
];

let all: string[] | null = null;

/** 常用的排前面，其餘照字母 */
export function timeZoneOptions(): string[] {
  if (all) return all;
  let rest: string[] = [];
  try {
    rest = Intl.supportedValuesOf('timeZone');
  } catch {
    rest = [];
  }
  const set = new Set(COMMON);
  all = [...COMMON, ...rest.filter((z) => !set.has(z))];
  return all;
}

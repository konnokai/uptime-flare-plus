import {
  HTTP_METHODS,
  type HttpMethod,
  type IncidentInput,
  type MaintenanceInput,
  type MonitorInput,
  type NotificationInput,
  type Settings,
} from '../shared/types';
import { HttpError } from './errors';
import { isDiscordWebhookUrl } from './notify/discord';
import { isValidTimeZone } from './time';

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new HttpError(400, message);
}

function asObject(v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('Request body must be a JSON object');
  return v as Obj;
}

function str(o: Obj, key: string, opts: { max?: number; required?: boolean; fallback?: string } = {}): string {
  const v = o[key] ?? opts.fallback ?? '';
  if (typeof v !== 'string') fail(`${key} must be a string`);
  const s = v.trim();
  if (opts.required && !s) fail(`${key} is required`);
  if (s.length > (opts.max ?? 1000)) fail(`${key} is too long (max ${opts.max ?? 1000})`);
  return s;
}

function bool(o: Obj, key: string, fallback: boolean): boolean {
  const v = o[key] ?? fallback;
  if (typeof v !== 'boolean') fail(`${key} must be a boolean`);
  return v;
}

function int(o: Obj, key: string, min: number, max: number, fallback: number): number {
  const v = o[key] ?? fallback;
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${key} must be an integer`);
  if (v < min || v > max) fail(`${key} must be between ${min} and ${max}`);
  return v;
}

function intList(o: Obj, key: string): number[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x))) fail(`${key} must be an array of integers`);
  return v as number[];
}

export const MIN_INTERVAL_S = 20;
const MAX_INTERVAL_S = 86_400;
const CODE_RULE = /^\d{3}(-\d{3})?$/;

export function parseMonitorInput(body: unknown, existingType?: MonitorInput['type']): MonitorInput {
  const o = asObject(body);
  const type = existingType ?? o.type;
  if (type !== 'http' && type !== 'push') fail('type must be "http" or "push"');
  const intervalS = int(o, 'intervalS', MIN_INTERVAL_S, MAX_INTERVAL_S, 60);

  const input: MonitorInput = {
    name: str(o, 'name', { required: true, max: 200 }),
    type,
    active: bool(o, 'active', true),
    intervalS,
    retryIntervalS: int(o, 'retryIntervalS', MIN_INTERVAL_S, MAX_INTERVAL_S, intervalS),
    retries: int(o, 'retries', 0, 100, 0),
    resendInterval: int(o, 'resendInterval', 0, 10_000, 0),
    upsideDown: bool(o, 'upsideDown', false),
    description: str(o, 'description', { max: 2000 }),
    isPublic: bool(o, 'isPublic', true),
    groupName: str(o, 'groupName', { max: 100 }),
    sortOrder: int(o, 'sortOrder', -1_000_000, 1_000_000, 0),
    url: '',
    method: 'GET',
    headers: {},
    body: '',
    acceptedCodes: ['200-299'],
    keyword: '',
    invertKeyword: false,
    timeoutS: 30,
    maxRedirects: 10,
    notificationIds: intList(o, 'notificationIds'),
  };
  if (type === 'push') return input;

  const url = str(o, 'url', { required: true, max: 2000 });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail('url must be http or https');

  const method = (o.method ?? 'GET') as HttpMethod;
  if (!HTTP_METHODS.includes(method)) fail(`method must be one of ${HTTP_METHODS.join(', ')}`);

  const headers = o.headers ?? {};
  if (
    typeof headers !== 'object' ||
    headers === null ||
    Array.isArray(headers) ||
    !Object.values(headers).every((v) => typeof v === 'string')
  ) {
    fail('headers must be an object of string values');
  }
  try {
    new Headers(headers as Record<string, string>);
  } catch {
    fail('headers contains an invalid header name or value');
  }

  const acceptedCodes = o.acceptedCodes ?? ['200-299'];
  if (
    !Array.isArray(acceptedCodes) ||
    acceptedCodes.length === 0 ||
    !acceptedCodes.every((c) => typeof c === 'string' && CODE_RULE.test(c.trim()))
  ) {
    fail('acceptedCodes must be a non-empty list like ["200-299", "301"]');
  }

  const timeoutS = int(o, 'timeoutS', 1, 300, Math.min(30, intervalS));
  if (timeoutS > intervalS) fail('timeoutS must not be longer than intervalS');

  return {
    ...input,
    url: parsed.toString(),
    method,
    headers: headers as Record<string, string>,
    body: str(o, 'body', { max: 65_536 }),
    acceptedCodes: (acceptedCodes as string[]).map((c) => c.trim()),
    keyword: typeof o.keyword === 'string' ? o.keyword.slice(0, 1000) : str(o, 'keyword'),
    invertKeyword: bool(o, 'invertKeyword', false),
    timeoutS,
    maxRedirects: int(o, 'maxRedirects', 0, 20, 10),
  };
}

export function parseNotificationInput(body: unknown): NotificationInput {
  const o = asObject(body);
  if ((o.type ?? 'discord') !== 'discord') fail('type must be "discord"');
  const webhookUrl = str(o, 'webhookUrl', { required: true, max: 500 });
  if (!isDiscordWebhookUrl(webhookUrl)) fail('webhookUrl must be a Discord webhook URL');
  return {
    name: str(o, 'name', { required: true, max: 100 }),
    type: 'discord',
    webhookUrl,
    username: str(o, 'username', { max: 80 }),
    isDefault: bool(o, 'isDefault', false),
    active: bool(o, 'active', true),
    applyToAll: bool(o, 'applyToAll', false),
  };
}

export function parseDiscordTest(body: unknown): { webhookUrl: string; username: string } {
  const o = asObject(body);
  const webhookUrl = str(o, 'webhookUrl', { required: true, max: 500 });
  if (!isDiscordWebhookUrl(webhookUrl)) fail('webhookUrl must be a Discord webhook URL');
  return { webhookUrl, username: str(o, 'username', { max: 80 }) };
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

function timestamp(o: Obj, key: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${key} must be a timestamp in milliseconds`);
  return Math.round(v);
}

export function parseMaintenanceInput(body: unknown): MaintenanceInput {
  const o = asObject(body);
  const strategy = o.strategy;
  if (strategy !== 'manual' && strategy !== 'single' && strategy !== 'weekly') {
    fail('strategy must be "manual", "single" or "weekly"');
  }
  const timezone = str(o, 'timezone', { fallback: 'Asia/Taipei', max: 100 });
  if (!isValidTimeZone(timezone)) fail('timezone is not a valid IANA time zone');

  const input: MaintenanceInput = {
    title: str(o, 'title', { required: true, max: 200 }),
    description: str(o, 'description', { max: 5000 }),
    strategy,
    active: bool(o, 'active', true),
    startAt: timestamp(o, 'startAt'),
    endAt: timestamp(o, 'endAt'),
    weekdays: [],
    startTime: str(o, 'startTime', { fallback: '00:00' }),
    endTime: str(o, 'endTime', { fallback: '00:00' }),
    timezone,
    monitorIds: intList(o, 'monitorIds') ?? [],
  };

  if (strategy === 'single') {
    if (input.startAt === null || input.endAt === null) fail('startAt and endAt are required');
    if (input.endAt <= input.startAt) fail('endAt must be after startAt');
  }
  if (strategy === 'weekly') {
    const weekdays = intList(o, 'weekdays') ?? [];
    if (weekdays.length === 0 || !weekdays.every((d) => d >= 0 && d <= 6)) {
      fail('weekdays must contain values 0 (Sunday) to 6 (Saturday)');
    }
    if (!HM.test(input.startTime) || !HM.test(input.endTime)) fail('startTime and endTime must be HH:MM');
    input.weekdays = [...new Set(weekdays)].sort();
  }
  return input;
}

export function parseIncidentInput(body: unknown): IncidentInput {
  const o = asObject(body);
  const style = o.style ?? 'info';
  if (style !== 'info' && style !== 'warning' && style !== 'danger') {
    fail('style must be "info", "warning" or "danger"');
  }
  return {
    title: str(o, 'title', { required: true, max: 200 }),
    content: str(o, 'content', { max: 20_000 }),
    style,
    pinned: bool(o, 'pinned', false),
  };
}

export function parseSettings(body: unknown): Settings {
  const o = asObject(body);
  const timezone = str(o, 'timezone', { required: true, max: 100 });
  if (!isValidTimeZone(timezone)) fail('timezone is not a valid IANA time zone');
  return {
    title: str(o, 'title', { required: true, max: 200 }),
    description: str(o, 'description', { max: 2000 }),
    footer: str(o, 'footer', { max: 2000 }),
    timezone,
    heartbeatRetentionDays: int(o, 'heartbeatRetentionDays', 1, 365, 30),
    statsRetentionDays: int(o, 'statsRetentionDays', 1, 3650, 365),
  };
}

export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found');
  return id;
}

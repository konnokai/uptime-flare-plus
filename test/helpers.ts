import { SELF } from 'cloudflare:test';
import { vi } from 'vitest';
import type { Monitor, MonitorInput, NotificationChannel } from '../shared/types';

// 帶 localhost 才會吃到 ACCESS_DEV_BYPASS
export const ORIGIN = 'http://localhost';

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await SELF.fetch(`${ORIGIN}${path}`, {
    ...rest,
    headers: json === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

export async function createMonitor(input: Partial<MonitorInput>): Promise<Monitor> {
  const res = await api<Monitor>('/api/admin/monitors', {
    method: 'POST',
    // 測試之間 D1 不會重置，預設不綁通知，免得前面建立的頻道被套進來
    json: { name: 'test', type: 'http', intervalS: 60, notificationIds: [], ...input },
  });
  if (res.status !== 201) throw new Error(`create monitor failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createDiscord(name = 'discord'): Promise<NotificationChannel> {
  const res = await api<NotificationChannel>('/api/admin/notifications', {
    method: 'POST',
    json: { name, webhookUrl: 'https://discord.com/api/webhooks/123/abc-DEF', isDefault: true },
  });
  if (res.status !== 201) throw new Error(`create notification failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export interface FetchMock {
  discordCalls: { url: string; body: any }[];
  restore(): void;
}

/** 攔截對外 fetch：Discord 一律 204，其他交給 handler */
export function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchMock {
  const discordCalls: FetchMock['discordCalls'] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://discord.com/')) {
      discordCalls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
      return new Response(null, { status: 204 });
    }
    return handler(url, init);
  });
  return { discordCalls, restore: () => spy.mockRestore() };
}

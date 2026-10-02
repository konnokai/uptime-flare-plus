import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATUS, type Heartbeat } from '../shared/types';
import { monitorStub } from '../worker/env';
import { api, createDiscord, createMonitor, mockFetch, type FetchMock } from './helpers';

let mock: FetchMock;
let httpStatus = 200;

beforeEach(() => {
  httpStatus = 200;
  mock = mockFetch((url) => {
    if (url.startsWith('https://target.test/')) return new Response('service ok', { status: httpStatus });
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => mock.restore());

async function beats(id: number): Promise<Heartbeat[]> {
  const res = await api<Heartbeat[]>(`/api/admin/monitors/${id}/heartbeats?limit=100`);
  return res.body.reverse();
}

async function push(token: string, query = '') {
  return api<{ ok: boolean }>(`/api/push/${token}${query}`);
}

describe('push monitor', () => {
  it('goes pending, then down, then recovers with notifications', async () => {
    const d = await createDiscord();
    const m = await createMonitor({
      name: 'cron job',
      type: 'push',
      intervalS: 60,
      retries: 1,
      retryIntervalS: 30,
      notificationIds: [d.id],
    });
    const stub = monitorStub(env, m.id);

    expect((await push(m.pushToken!, '?status=up&msg=hi&ping=12')).body).toEqual({ ok: true });
    let snap = await stub.getSnapshot();
    expect(snap.state.status).toBe(STATUS.UP);
    // 下一次 alarm = 現在 + 60 秒 + 1 秒緩衝
    expect(snap.alarm! - Date.now()).toBeGreaterThan(59_000);

    await runDurableObjectAlarm(stub);
    snap = await stub.getSnapshot();
    expect(snap.state.status).toBe(STATUS.PENDING);
    expect(snap.alarm! - Date.now()).toBeLessThanOrEqual(30_000);
    expect(mock.discordCalls).toHaveLength(0);

    await runDurableObjectAlarm(stub);
    expect((await stub.getSnapshot()).state.status).toBe(STATUS.DOWN);
    expect(mock.discordCalls).toHaveLength(1);
    expect(mock.discordCalls[0]!.body.embeds[0].title).toContain('cron job');

    // 持續 down 不會重複通知（resendInterval = 0）
    await runDurableObjectAlarm(stub);
    expect(mock.discordCalls).toHaveLength(1);

    await push(m.pushToken!);
    expect((await stub.getSnapshot()).state.status).toBe(STATUS.UP);
    expect(mock.discordCalls).toHaveLength(2);
    expect(mock.discordCalls[1]!.body.embeds[0].title).toContain('已恢復');

    const list = await beats(m.id);
    expect(list.map((b) => b.status)).toEqual([STATUS.UP, STATUS.PENDING, STATUS.DOWN, STATUS.DOWN, STATUS.UP]);
    expect(list.map((b) => b.important)).toEqual([true, true, true, false, true]);
    expect(list[0]).toMatchObject({ msg: 'hi', latencyMs: 12 });
  });

  it('explicit status=down skips retries', async () => {
    const m = await createMonitor({ type: 'push', retries: 5 });
    await push(m.pushToken!, '?status=down&msg=disk%20full');
    const snap = await monitorStub(env, m.id).getSnapshot();
    expect(snap.state.status).toBe(STATUS.DOWN);
  });

  it('resends notification every N consecutive downs', async () => {
    const d = await createDiscord();
    const m = await createMonitor({ type: 'push', resendInterval: 2, notificationIds: [d.id] });
    const stub = monitorStub(env, m.id);
    for (let i = 0; i < 5; i++) await runDurableObjectAlarm(stub);
    // 第 1 次 down 通知，之後第 3、5 次（連續 down 2、4 次）重送
    expect(mock.discordCalls).toHaveLength(3);
  });

  it('rejects unknown token and paused monitor', async () => {
    expect((await push('nope')).status).toBe(404);
    const m = await createMonitor({ type: 'push' });
    await api(`/api/admin/monitors/${m.id}/pause`, { method: 'POST' });
    const res = await push(m.pushToken!);
    expect(res.status).toBe(404);
    expect((await monitorStub(env, m.id).getSnapshot()).alarm).toBeNull();
  });

  it('unrelated config changes do not push back the deadline', async () => {
    const m = await createMonitor({ type: 'push', intervalS: 3600 });
    const stub = monitorStub(env, m.id);
    await push(m.pushToken!);
    const before = (await stub.getSnapshot()).alarm;
    await api('/api/admin/maintenances', {
      method: 'POST',
      json: { title: 'later', strategy: 'single', startAt: Date.now() + 86_400_000, endAt: Date.now() + 90_000_000, monitorIds: [m.id] },
    });
    expect((await stub.getSnapshot()).alarm).toBe(before);
    // 改間隔才重排
    await api(`/api/admin/monitors/${m.id}`, { method: 'PUT', json: { ...m, intervalS: 1800 } });
    expect((await stub.getSnapshot()).alarm).not.toBe(before);
  });

  it('rejects invalid ping', async () => {
    const m = await createMonitor({ type: 'push' });
    expect((await push(m.pushToken!, '?ping=abc')).status).toBe(404);
  });
});

describe('http monitor', () => {
  it('checks on alarm and records latency', async () => {
    const d = await createDiscord();
    const m = await createMonitor({ url: 'https://target.test/health', retries: 0, notificationIds: [d.id] });
    const stub = monitorStub(env, m.id);
    expect((await stub.getSnapshot()).alarm).not.toBeNull();

    await runDurableObjectAlarm(stub);
    httpStatus = 500;
    await runDurableObjectAlarm(stub);
    httpStatus = 200;
    await runDurableObjectAlarm(stub);

    const list = await beats(m.id);
    expect(list.map((b) => b.status)).toEqual([STATUS.UP, STATUS.DOWN, STATUS.UP]);
    expect(list[1]!.msg).toContain('500');
    expect(mock.discordCalls).toHaveLength(2);

    const stats = await api<{ uptime24h: number; daily: { up: number; down: number }[] }>(
      `/api/admin/monitors/${m.id}/stats`,
    );
    expect(stats.body.uptime24h).toBeCloseTo(2 / 3);
    expect(stats.body.daily).toHaveLength(90);
    expect(stats.body.daily.at(-1)).toMatchObject({ up: 2, down: 1 });
  });

  it('upside down mode inverts the result', async () => {
    const m = await createMonitor({ url: 'https://target.test/', upsideDown: true });
    const stub = monitorStub(env, m.id);
    await runDurableObjectAlarm(stub);
    expect((await stub.getSnapshot()).state.status).toBe(STATUS.DOWN);
  });

  it('records maintenance instead of down and does not notify', async () => {
    const d = await createDiscord();
    const m = await createMonitor({ url: 'https://target.test/', notificationIds: [d.id] });
    const res = await api('/api/admin/maintenances', {
      method: 'POST',
      json: { title: 'upgrade', strategy: 'manual', active: true, monitorIds: [m.id] },
    });
    expect(res.status).toBe(201);
    httpStatus = 500;
    const stub = monitorStub(env, m.id);
    await runDurableObjectAlarm(stub);
    expect((await stub.getSnapshot()).state.status).toBe(STATUS.MAINTENANCE);
    expect(mock.discordCalls).toHaveLength(0);

    const stats = await api<{ daily: { up: number; down: number }[] }>(`/api/admin/monitors/${m.id}/stats`);
    expect(stats.body.daily.at(-1)).toMatchObject({ up: 0, down: 0 });
  });

  it('deleting a monitor clears its DO', async () => {
    const m = await createMonitor({ url: 'https://target.test/' });
    expect((await api(`/api/admin/monitors/${m.id}`, { method: 'DELETE' })).status).toBe(200);
    const snap = await monitorStub(env, m.id).getSnapshot();
    expect(snap).toMatchObject({ config: null, alarm: null });
  });
});

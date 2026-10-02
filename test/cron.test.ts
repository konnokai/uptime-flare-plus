import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { monitorStub } from '../worker/env';
import { runCleanup, runWatchdog } from '../worker/index';
import { createMonitor } from './helpers';

const DAY_MS = 86_400_000;

describe('cron jobs', () => {
  it('watchdog restores a missing alarm', async () => {
    const m = await createMonitor({ type: 'push' });
    const stub = monitorStub(env, m.id);
    // 模擬 DO 遺失排程
    await stub.destroy();
    expect((await stub.getSnapshot()).alarm).toBeNull();
    await runWatchdog(env);
    const snap = await stub.getSnapshot();
    expect(snap.alarm).not.toBeNull();
    expect(snap.config?.monitorId).toBe(m.id);
  });

  it('cleanup removes heartbeats and stats past retention', async () => {
    const m = await createMonitor({ type: 'push' });
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO heartbeats (monitor_id, ts, status) VALUES (?, ?, 1)').bind(m.id, now - 40 * DAY_MS),
      env.DB.prepare('INSERT INTO heartbeats (monitor_id, ts, status) VALUES (?, ?, 1)').bind(m.id, now - DAY_MS),
      env.DB.prepare("INSERT INTO daily_stats (monitor_id, day, up) VALUES (?, '2000-01-01', 1)").bind(m.id),
      env.DB.prepare("INSERT INTO daily_stats (monitor_id, day, up) VALUES (?, '2999-01-01', 1)").bind(m.id),
    ]);
    await runCleanup(env, now);
    const hb = await env.DB.prepare('SELECT COUNT(*) AS n FROM heartbeats WHERE monitor_id = ?').bind(m.id).first<{ n: number }>();
    const st = await env.DB.prepare('SELECT day FROM daily_stats WHERE monitor_id = ?').bind(m.id).all<{ day: string }>();
    expect(hb!.n).toBe(1);
    expect(st.results.map((r) => r.day)).toEqual(['2999-01-01']);
  });
});

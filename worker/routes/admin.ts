import { Hono } from 'hono';
import type { MaintenanceWithState, MonitorStats, MonitorSummary } from '../../shared/types';
import { accessAuth, type AdminVariables } from '../auth/access';
import * as db from '../db';
import { monitorStub, type Env } from '../env';
import { HttpError } from '../errors';
import { currentWindow, nextWindow } from '../maintenance';
import { sendDiscord, testMessage } from '../notify/discord';
import { lastNDays } from '../time';
import {
  parseDiscordTest,
  parseId,
  parseIncidentInput,
  parseMaintenanceInput,
  parseMonitorInput,
  parseNotificationInput,
  parseSettings,
} from '../validate';
import { purgeStatusCache } from './public';

const DAY_MS = 86_400_000;
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generatePushToken(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 62 個字元取餘數有一點偏差，對 token 不構成問題
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join('');
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

function notFound(): never {
  throw new HttpError(404, 'Not found');
}

async function configureMonitors(env: Env, ids: Iterable<number>): Promise<void> {
  const results = await Promise.allSettled([...new Set(ids)].map((id) => monitorStub(env, id).configure(id)));
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('configure failed', r.reason);
  });
}

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AdminVariables }>();

adminRoutes.use('*', accessAuth());

// Access 的登入 cookie 會隨跨站請求送出；寫入類請求只接受同站來源，防 CSRF
adminRoutes.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const site = c.req.header('sec-fetch-site');
  const origin = c.req.header('origin');
  const crossSite = site === 'cross-site' || site === 'same-site';
  const foreignOrigin = origin !== undefined && origin !== new URL(c.req.url).origin;
  if (crossSite || foreignOrigin) return c.json({ error: 'Cross-site request rejected' }, 403);
  return next();
});

// 任何寫入都可能影響狀態頁，統一在這裡清快取
adminRoutes.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.ok) c.executionCtx.waitUntil(purgeStatusCache(c.req.url));
});

adminRoutes.get('/me', (c) => c.json({ email: c.get('email') }));

// ---------- monitors ----------

adminRoutes.get('/monitors', async (c) => {
  const monitors = await db.listMonitors(c.env.DB);
  const ids = monitors.map((m) => m.id);
  const [recent, uptime] = await Promise.all([
    db.recentHeartbeats(c.env.DB, ids, 30),
    db.uptimeSince(c.env.DB, ids, Date.now() - DAY_MS),
  ]);
  const list: MonitorSummary[] = monitors.map((m) => {
    const beats = recent.get(m.id) ?? [];
    const last = beats.at(-1);
    const u = uptime.get(m.id);
    return {
      ...m,
      lastStatus: last?.status ?? null,
      lastBeatAt: last?.ts ?? null,
      lastLatencyMs: last?.latencyMs ?? null,
      lastMsg: last?.msg ?? null,
      uptime24h: u ? db.uptimeRatio(u.up, u.down) : null,
      recent: beats,
    };
  });
  return c.json(list);
});

adminRoutes.post('/monitors', async (c) => {
  const input = parseMonitorInput(await readJson(c.req.raw));
  const { notificationIds, ...fields } = input;
  const id = await db.insertMonitor(
    c.env.DB,
    fields,
    notificationIds,
    input.type === 'push' ? generatePushToken() : null,
    Date.now(),
  );
  await configureMonitors(c.env, [id]);
  return c.json(await db.getMonitor(c.env.DB, id), 201);
});

adminRoutes.get('/monitors/:id', async (c) => {
  const m = await db.getMonitor(c.env.DB, parseId(c.req.param('id')));
  return m ? c.json(m) : notFound();
});

adminRoutes.put('/monitors/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const existing = await db.getMonitor(c.env.DB, id);
  if (!existing) notFound();
  // 類型不能改：push token 和 DO 狀態都跟類型綁在一起
  const { notificationIds, ...fields } = parseMonitorInput(await readJson(c.req.raw), existing.type);
  await db.updateMonitor(c.env.DB, id, fields, notificationIds, Date.now());
  await configureMonitors(c.env, [id]);
  return c.json(await db.getMonitor(c.env.DB, id));
});

adminRoutes.delete('/monitors/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!(await db.deleteMonitor(c.env.DB, id))) notFound();
  await monitorStub(c.env, id).destroy();
  return c.json({ ok: true });
});

for (const [action, active] of [
  ['pause', false],
  ['resume', true],
] as const) {
  adminRoutes.post(`/monitors/:id/${action}`, async (c) => {
    const id = parseId(c.req.param('id'));
    if (!(await db.setMonitorActive(c.env.DB, id, active, Date.now()))) notFound();
    await configureMonitors(c.env, [id]);
    return c.json(await db.getMonitor(c.env.DB, id));
  });
}

adminRoutes.post('/monitors/:id/regenerate-token', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!(await db.setPushToken(c.env.DB, id, generatePushToken(), Date.now()))) notFound();
  await configureMonitors(c.env, [id]);
  return c.json(await db.getMonitor(c.env.DB, id));
});

function limitParam(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value ?? fallback);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

adminRoutes.get('/monitors/:id/heartbeats', async (c) => {
  const id = parseId(c.req.param('id'));
  const before = c.req.query('before');
  const beats = await db.listHeartbeats(
    c.env.DB,
    id,
    limitParam(c.req.query('limit'), 100, 1000),
    before ? Number(before) : undefined,
  );
  return c.json(beats);
});

adminRoutes.get('/monitors/:id/events', async (c) => {
  const id = parseId(c.req.param('id'));
  return c.json(await db.listImportantHeartbeats(c.env.DB, id, limitParam(c.req.query('limit'), 50, 500)));
});

adminRoutes.get('/monitors/:id/stats', async (c) => {
  const id = parseId(c.req.param('id'));
  const now = Date.now();
  const settings = await db.getSettings(c.env.DB);
  const [uptime, daily] = await Promise.all([
    db.uptimeSince(c.env.DB, [id], now - DAY_MS),
    db.dailyStats(c.env.DB, [id], lastNDays(now, settings.timezone, 90)),
  ]);
  const u = uptime.get(id)!;
  const d = daily.get(id)!;
  const stats: MonitorStats = {
    uptime24h: db.uptimeRatio(u.up, u.down),
    uptime30d: db.sumDaily(d, 30),
    uptime90d: db.sumDaily(d, 90),
    avgLatency24h: u.latencyCount > 0 ? Math.round(u.latencySum / u.latencyCount) : null,
    daily: d,
  };
  return c.json(stats);
});

// ---------- notifications ----------

adminRoutes.get('/notifications', async (c) => c.json(await db.listNotifications(c.env.DB)));

adminRoutes.post('/notifications/test', async (c) => {
  const target = parseDiscordTest(await readJson(c.req.raw));
  try {
    await sendDiscord(target, testMessage());
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : String(err));
  }
  return c.json({ ok: true });
});

adminRoutes.post('/notifications', async (c) => {
  const id = await db.insertNotification(c.env.DB, parseNotificationInput(await readJson(c.req.raw)), Date.now());
  return c.json(await db.getNotification(c.env.DB, id), 201);
});

adminRoutes.put('/notifications/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const input = parseNotificationInput(await readJson(c.req.raw));
  if (!(await db.updateNotification(c.env.DB, id, input, Date.now()))) notFound();
  return c.json(await db.getNotification(c.env.DB, id));
});

adminRoutes.delete('/notifications/:id', async (c) => {
  if (!(await db.deleteNotification(c.env.DB, parseId(c.req.param('id'))))) notFound();
  return c.json({ ok: true });
});

// ---------- maintenances ----------

adminRoutes.get('/maintenances', async (c) => {
  const now = Date.now();
  const list: MaintenanceWithState[] = (await db.listMaintenances(c.env.DB)).map((m) => {
    const cur = currentWindow(m, now);
    return { ...m, inProgress: cur !== null, window: cur ?? nextWindow(m, now) };
  });
  return c.json(list);
});

/** manual 從關到開時記下開始時間，狀態頁才能顯示「從何時開始」 */
function withManualStart<T extends { strategy: string; active: boolean; startAt: number | null }>(
  input: T,
  previous: { active: boolean; startAt: number | null } | null,
  now: number,
): T {
  if (input.strategy !== 'manual') return input;
  if (!input.active) return { ...input, startAt: null };
  return { ...input, startAt: previous?.active && previous.startAt ? previous.startAt : now };
}

adminRoutes.post('/maintenances', async (c) => {
  const now = Date.now();
  const input = withManualStart(parseMaintenanceInput(await readJson(c.req.raw)), null, now);
  const id = await db.insertMaintenance(c.env.DB, input, now);
  await configureMonitors(c.env, input.monitorIds);
  return c.json(await db.getMaintenance(c.env.DB, id), 201);
});

adminRoutes.put('/maintenances/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const existing = await db.getMaintenance(c.env.DB, id);
  if (!existing) notFound();
  const now = Date.now();
  const input = withManualStart(parseMaintenanceInput(await readJson(c.req.raw)), existing, now);
  await db.updateMaintenance(c.env.DB, id, input, now);
  // 舊的和新的 monitor 都要重新載入：被移出的也要知道維護結束了
  await configureMonitors(c.env, [...existing.monitorIds, ...input.monitorIds]);
  return c.json(await db.getMaintenance(c.env.DB, id));
});

adminRoutes.delete('/maintenances/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const existing = await db.getMaintenance(c.env.DB, id);
  if (!existing) notFound();
  await db.deleteMaintenance(c.env.DB, id);
  await configureMonitors(c.env, existing.monitorIds);
  return c.json({ ok: true });
});

// ---------- incidents ----------

adminRoutes.get('/incidents', async (c) => c.json(await db.listIncidents(c.env.DB)));

adminRoutes.post('/incidents', async (c) => {
  const id = await db.insertIncident(c.env.DB, parseIncidentInput(await readJson(c.req.raw)), Date.now());
  return c.json(await db.getIncident(c.env.DB, id), 201);
});

adminRoutes.put('/incidents/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!(await db.updateIncident(c.env.DB, id, parseIncidentInput(await readJson(c.req.raw)), Date.now()))) notFound();
  return c.json(await db.getIncident(c.env.DB, id));
});

adminRoutes.post('/incidents/:id/resolve', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!(await db.resolveIncident(c.env.DB, id, Date.now()))) notFound();
  return c.json(await db.getIncident(c.env.DB, id));
});

adminRoutes.delete('/incidents/:id', async (c) => {
  if (!(await db.deleteIncident(c.env.DB, parseId(c.req.param('id'))))) notFound();
  return c.json({ ok: true });
});

// ---------- settings ----------

adminRoutes.get('/settings', async (c) => c.json(await db.getSettings(c.env.DB)));

adminRoutes.put('/settings', async (c) => {
  const next = parseSettings(await readJson(c.req.raw));
  const prev = await db.getSettings(c.env.DB);
  await db.putSettings(c.env.DB, next);
  if (prev.timezone !== next.timezone) {
    // 時區影響每日統計的日期切點，所有 monitor 都要重新載入
    c.executionCtx.waitUntil(configureMonitors(c.env, await db.listMonitorIds(c.env.DB)));
  }
  return c.json(next);
});

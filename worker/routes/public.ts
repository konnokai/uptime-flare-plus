import { Hono, type Context } from 'hono';
import {
  STATUS,
  type OverallStatus,
  type PublicMaintenance,
  type PublicMonitor,
  type PublicStatus,
} from '../../shared/types';
import {
  dailyStats,
  findPushMonitorId,
  getSettings,
  listMaintenances,
  listMonitors,
  listPublicIncidents,
  recentHeartbeats,
  sumDaily,
  uptimeRatio,
  uptimeSince,
  withTimeout,
} from '../db';
import { monitorStub, type Env } from '../env';
import { currentWindow, nextWindow } from '../maintenance';
import { lastNDays } from '../time';

const DAY_MS = 86_400_000;
const STATUS_CACHE_TTL_S = 30;
const MAX_PING_MS = 100_000_000_000;
/** 舊 token 由 DO 擋掉，快取放久一點也沒關係 */
const PUSH_TOKEN_CACHE_TTL_S = 7 * 86_400;

export const STATUS_PATH = '/api/status';

/** 管理端改了東西後清掉本機房的快取；其他機房最多晚 30 秒 */
export async function purgeStatusCache(requestUrl: string): Promise<void> {
  await caches.default.delete(new Request(new URL(STATUS_PATH, requestUrl).toString()));
}

export async function buildPublicStatus(db: D1Database, now: number): Promise<PublicStatus> {
  const [settings, monitors, maintenances, incidents] = await Promise.all([
    getSettings(db),
    listMonitors(db),
    listMaintenances(db),
    listPublicIncidents(db, now - 7 * DAY_MS),
  ]);
  const visible = monitors.filter((m) => m.isPublic && m.active);
  const ids = visible.map((m) => m.id);
  const days = lastNDays(now, settings.timezone, 90);
  const [recent, uptime24h, daily] = await Promise.all([
    recentHeartbeats(db, ids, 50),
    uptimeSince(db, ids, now - DAY_MS),
    dailyStats(db, ids, days),
  ]);

  const publicMonitors: PublicMonitor[] = visible.map((m) => {
    const beats = recent.get(m.id) ?? [];
    const d = daily.get(m.id) ?? [];
    const u = uptime24h.get(m.id);
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      type: m.type,
      status: beats.at(-1)?.status ?? null,
      uptime24h: u ? uptimeRatio(u.up, u.down) : null,
      uptime30d: sumDaily(d, 30),
      uptime90d: sumDaily(d, 90),
      recent: beats.map((b) => ({ ts: b.ts, status: b.status, latencyMs: b.latencyMs, msg: b.msg })),
      daily: d,
    };
  });

  const groups: PublicStatus['groups'] = [];
  for (const pm of publicMonitors) {
    const name = visible.find((m) => m.id === pm.id)!.groupName;
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, monitors: [] }));
    group.monitors.push(pm);
  }

  const visibleIds = new Set(ids);
  const publicMaintenances: PublicMaintenance[] = [];
  for (const m of maintenances) {
    const cur = currentWindow(m, now);
    const upcoming = cur ? null : nextWindow(m, now);
    if (!cur && !(upcoming && upcoming.start - now <= DAY_MS)) continue;
    const monitorIds = m.monitorIds.filter((id) => visibleIds.has(id));
    if (monitorIds.length === 0 && m.monitorIds.length > 0) continue;
    publicMaintenances.push({
      id: m.id,
      title: m.title,
      description: m.description,
      inProgress: cur !== null,
      window: cur ?? upcoming,
      monitorIds,
    });
  }

  return {
    title: settings.title,
    description: settings.description,
    footer: settings.footer,
    timezone: settings.timezone,
    generatedAt: now,
    overall: overallStatus(publicMonitors),
    incidents,
    maintenances: publicMaintenances,
    groups,
  };
}

function overallStatus(monitors: PublicMonitor[]): OverallStatus {
  const statuses = monitors.map((m) => m.status).filter((s) => s !== null);
  if (statuses.length === 0) return 'unknown';
  const down = statuses.filter((s) => s === STATUS.DOWN).length;
  if (down > 0) return down === statuses.length ? 'down' : 'degraded';
  if (statuses.some((s) => s === STATUS.MAINTENANCE)) return 'maintenance';
  return 'up';
}

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get(STATUS_PATH, async (c) => {
  const cacheKey = new Request(new URL(STATUS_PATH, c.req.url).toString());
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const body = await buildPublicStatus(c.env.DB, Date.now());
  const res = new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${STATUS_CACHE_TTL_S}`,
    },
  });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
});

async function handlePush(c: Context<{ Bindings: Env }>) {
  const token = c.req.param('token') ?? '';
  const status = c.req.query('status') === 'up' || c.req.query('status') === undefined ? 'up' : 'down';
  const msg = (c.req.query('msg') ?? 'OK').slice(0, 1000);
  const pingRaw = c.req.query('ping');
  let ping: number | null = null;
  if (pingRaw !== undefined && pingRaw !== '') {
    ping = Number(pingRaw);
    if (!Number.isFinite(ping) || ping < 0 || ping > MAX_PING_MS) {
      return c.json({ ok: false, msg: 'Invalid ping value' }, 404);
    }
  }

  const input = { token, status, msg, ping } as const;

  // 先查快取，D1 故障時已經 push 過的服務才不會被誤判成 down
  const cacheKey = new Request(new URL(`/__push-token/${encodeURIComponent(token)}`, c.req.url).toString());
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    if (await monitorStub(c.env, Number(await cached.text())).push(input)) return c.json({ ok: true });
    // token 換過、monitor 停用或刪除，或 DO 還沒設定：丟掉快取，照 D1 的結果走
    await caches.default.delete(cacheKey);
  }

  const id = await withTimeout(findPushMonitorId(c.env.DB, token));
  if (id === null) return c.json({ ok: false, msg: 'Monitor not found or not active.' }, 404);
  const stub = monitorStub(c.env, id);
  let accepted = await stub.push(input);
  if (!accepted) {
    // D1 說存在但 DO 沒設定（例如設定時 DO 呼叫失敗）：補一次 configure 再試
    await withTimeout(stub.configure(id));
    accepted = await stub.push(input);
  }
  if (!accepted) return c.json({ ok: false, msg: 'Monitor not found or not active.' }, 404);
  await caches.default.put(
    cacheKey,
    new Response(String(id), { headers: { 'cache-control': `max-age=${PUSH_TOKEN_CACHE_TTL_S}` } }),
  );
  return c.json({ ok: true });
}

// Kuma 的 push 端點接受任何 HTTP method
publicRoutes.all('/api/push/:token', handlePush);

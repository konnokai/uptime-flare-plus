import { Hono } from 'hono';
import { getSettings, listMonitorIds, purgeOldData } from './db';
import { monitorStub, type Env } from './env';
import { HttpError } from './errors';
import { adminRoutes } from './routes/admin';
import { publicRoutes } from './routes/public';
import { dayKey } from './time';

export { MonitorDO } from './monitor-do';

const DAY_MS = 86_400_000;
const WATCHDOG_CONCURRENCY = 25;
export const CLEANUP_CRON = '17 19 * * *';

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

app.route('/', publicRoutes);
app.route('/api/admin', adminRoutes);
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
// run_worker_first 只攔 /api/*，其他路徑照理不會進來；保險起見交回靜態資產
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

/** 讓每個 monitor 的 DO 對齊 D1 設定，補回遺失的 alarm */
export async function runWatchdog(env: Env): Promise<void> {
  const ids = await listMonitorIds(env.DB);
  for (let i = 0; i < ids.length; i += WATCHDOG_CONCURRENCY) {
    const chunk = ids.slice(i, i + WATCHDOG_CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((id) => monitorStub(env, id).configure(id)));
    results.forEach((r, j) => {
      if (r.status === 'rejected') console.error('watchdog configure failed', chunk[j], r.reason);
    });
  }
}

export async function runCleanup(env: Env, now = Date.now()): Promise<void> {
  const settings = await getSettings(env.DB);
  const ids = await listMonitorIds(env.DB);
  await purgeOldData(
    env.DB,
    ids,
    now - settings.heartbeatRetentionDays * DAY_MS,
    dayKey(now - settings.statsRetentionDays * DAY_MS, settings.timezone),
  );
}

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(controller.cron === CLEANUP_CRON ? runCleanup(env) : runWatchdog(env));
  },
} satisfies ExportedHandler<Env>;

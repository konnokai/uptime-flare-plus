import type {
  DailyStat,
  Heartbeat,
  HttpMethod,
  Incident,
  IncidentInput,
  IncidentStyle,
  Maintenance,
  MaintenanceInput,
  MaintenanceStrategy,
  Monitor,
  MonitorInput,
  MonitorType,
  NotificationChannel,
  NotificationInput,
  Settings,
  Status,
} from '../shared/types';

// ---------- monitors ----------

interface MonitorRow {
  id: number;
  name: string;
  type: MonitorType;
  active: number;
  interval_s: number;
  retry_interval_s: number;
  retries: number;
  resend_interval: number;
  upside_down: number;
  description: string;
  is_public: number;
  group_name: string;
  sort_order: number;
  url: string;
  method: HttpMethod;
  headers: string;
  body: string;
  accepted_codes: string;
  keyword: string;
  invert_keyword: number;
  timeout_s: number;
  max_redirects: number;
  push_token: string | null;
  created_at: number;
  updated_at: number;
}

function rowToMonitor(row: MonitorRow, notificationIds: number[]): Monitor {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    active: row.active === 1,
    intervalS: row.interval_s,
    retryIntervalS: row.retry_interval_s,
    retries: row.retries,
    resendInterval: row.resend_interval,
    upsideDown: row.upside_down === 1,
    description: row.description,
    isPublic: row.is_public === 1,
    groupName: row.group_name,
    sortOrder: row.sort_order,
    url: row.url,
    method: row.method,
    headers: JSON.parse(row.headers) as Record<string, string>,
    body: row.body,
    acceptedCodes: JSON.parse(row.accepted_codes) as string[],
    keyword: row.keyword,
    invertKeyword: row.invert_keyword === 1,
    timeoutS: row.timeout_s,
    maxRedirects: row.max_redirects,
    pushToken: row.push_token,
    notificationIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function notificationIdsByMonitor(db: D1Database): Promise<Map<number, number[]>> {
  const { results } = await db
    .prepare('SELECT monitor_id, notification_id FROM monitor_notifications ORDER BY notification_id')
    .all<{ monitor_id: number; notification_id: number }>();
  const map = new Map<number, number[]>();
  for (const r of results) {
    const list = map.get(r.monitor_id) ?? [];
    list.push(r.notification_id);
    map.set(r.monitor_id, list);
  }
  return map;
}

export async function listMonitors(db: D1Database): Promise<Monitor[]> {
  const [{ results }, ids] = await Promise.all([
    db.prepare('SELECT * FROM monitors ORDER BY sort_order, name, id').all<MonitorRow>(),
    notificationIdsByMonitor(db),
  ]);
  return results.map((r) => rowToMonitor(r, ids.get(r.id) ?? []));
}

export async function getMonitor(db: D1Database, id: number): Promise<Monitor | null> {
  const [row, ids] = await db.batch<MonitorRow | { notification_id: number }>([
    db.prepare('SELECT * FROM monitors WHERE id = ?').bind(id),
    db
      .prepare('SELECT notification_id FROM monitor_notifications WHERE monitor_id = ? ORDER BY notification_id')
      .bind(id),
  ]);
  const m = row!.results[0] as MonitorRow | undefined;
  if (!m) return null;
  return rowToMonitor(
    m,
    (ids!.results as { notification_id: number }[]).map((r) => r.notification_id),
  );
}

/** D1 故障時一個呼叫可能卡幾十秒才失敗，等不了那麼久 */
export const D1_TIMEOUT_MS = 10_000;

/** 只是不再等，D1 那邊的呼叫不會被取消 */
export function withTimeout<T>(promise: Promise<T>, ms = D1_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`D1 call timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function findPushMonitorId(db: D1Database, token: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM monitors WHERE push_token = ? AND type = 'push' AND active = 1")
    .bind(token)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function listMonitorIds(db: D1Database): Promise<number[]> {
  const { results } = await db.prepare('SELECT id FROM monitors').all<{ id: number }>();
  return results.map((r) => r.id);
}

type MonitorFields = Omit<MonitorInput, 'notificationIds'>;

function monitorValues(m: MonitorFields): unknown[] {
  return [
    m.name,
    m.active ? 1 : 0,
    m.intervalS,
    m.retryIntervalS,
    m.retries,
    m.resendInterval,
    m.upsideDown ? 1 : 0,
    m.description,
    m.isPublic ? 1 : 0,
    m.groupName,
    m.sortOrder,
    m.url,
    m.method,
    JSON.stringify(m.headers),
    m.body,
    JSON.stringify(m.acceptedCodes),
    m.keyword,
    m.invertKeyword ? 1 : 0,
    m.timeoutS,
    m.maxRedirects,
  ];
}

const MONITOR_COLUMNS =
  'name, active, interval_s, retry_interval_s, retries, resend_interval, upside_down, description, is_public, group_name, sort_order, url, method, headers, body, accepted_codes, keyword, invert_keyword, timeout_s, max_redirects';

function notificationLinkStatements(db: D1Database, monitorId: number, ids: number[]): D1PreparedStatement[] {
  const stmts = [db.prepare('DELETE FROM monitor_notifications WHERE monitor_id = ?').bind(monitorId)];
  // 用 SELECT 過濾掉不存在的通知 id，不必先查一次
  for (const nid of new Set(ids)) {
    stmts.push(
      db
        .prepare('INSERT INTO monitor_notifications (monitor_id, notification_id) SELECT ?, id FROM notifications WHERE id = ?')
        .bind(monitorId, nid),
    );
  }
  return stmts;
}

export async function insertMonitor(
  db: D1Database,
  m: MonitorFields,
  notificationIds: number[] | undefined,
  pushToken: string | null,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO monitors (type, ${MONITOR_COLUMNS}, push_token, created_at, updated_at)
       VALUES (?, ${Array(20).fill('?').join(', ')}, ?, ?, ?) RETURNING id`,
    )
    .bind(m.type, ...monitorValues(m), pushToken, now, now)
    .first<{ id: number }>();
  const id = row!.id;
  if (notificationIds) {
    await db.batch(notificationLinkStatements(db, id, notificationIds));
  } else {
    await db
      .prepare(
        'INSERT INTO monitor_notifications (monitor_id, notification_id) SELECT ?, id FROM notifications WHERE is_default = 1',
      )
      .bind(id)
      .run();
  }
  return id;
}

export async function updateMonitor(
  db: D1Database,
  id: number,
  m: MonitorFields,
  notificationIds: number[] | undefined,
  now: number,
): Promise<boolean> {
  const sets = MONITOR_COLUMNS.split(', ')
    .map((c) => `${c} = ?`)
    .join(', ');
  const stmts = [
    db.prepare(`UPDATE monitors SET ${sets}, updated_at = ? WHERE id = ?`).bind(...monitorValues(m), now, id),
  ];
  if (notificationIds) stmts.push(...notificationLinkStatements(db, id, notificationIds));
  const [res] = await db.batch(stmts);
  return (res!.meta.changes ?? 0) > 0;
}

export async function setMonitorActive(db: D1Database, id: number, active: boolean, now: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE monitors SET active = ?, updated_at = ? WHERE id = ?')
    .bind(active ? 1 : 0, now, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function setPushToken(db: D1Database, id: number, token: string, now: number): Promise<boolean> {
  const res = await db
    .prepare("UPDATE monitors SET push_token = ?, updated_at = ? WHERE id = ? AND type = 'push'")
    .bind(token, now, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteMonitor(db: D1Database, id: number): Promise<boolean> {
  const [res] = await db.batch([
    db.prepare('DELETE FROM monitors WHERE id = ?').bind(id),
    db.prepare('DELETE FROM monitor_notifications WHERE monitor_id = ?').bind(id),
    db.prepare('DELETE FROM maintenance_monitors WHERE monitor_id = ?').bind(id),
    db.prepare('DELETE FROM daily_stats WHERE monitor_id = ?').bind(id),
    db.prepare('DELETE FROM heartbeats WHERE monitor_id = ?').bind(id),
  ]);
  return (res!.meta.changes ?? 0) > 0;
}

// ---------- heartbeats / stats ----------

interface HeartbeatRow {
  id: number;
  monitor_id: number;
  ts: number;
  status: Status;
  latency_ms: number | null;
  msg: string;
  important: number;
}

function rowToHeartbeat(r: HeartbeatRow): Heartbeat {
  return {
    id: r.id,
    monitorId: r.monitor_id,
    ts: r.ts,
    status: r.status,
    latencyMs: r.latency_ms,
    msg: r.msg,
    important: r.important === 1,
  };
}

export interface HeartbeatWrite {
  monitorId: number;
  ts: number;
  status: Status;
  latencyMs: number | null;
  msg: string;
  important: boolean;
  day: string;
}

/**
 * 寫入心跳並累加當日統計，整批一起成功或失敗。monitor 已刪除或停用時不寫；
 * 最後一筆沒寫進去就回傳 false，讓殘留的 DO 自己停掉 alarm。
 */
export async function writeHeartbeats(db: D1Database, beats: HeartbeatWrite[]): Promise<boolean> {
  const results = await db.batch(beats.flatMap((hb) => heartbeatStatements(db, hb)));
  return (results.at(-2)!.meta.changes ?? 0) > 0;
}

function heartbeatStatements(db: D1Database, hb: HeartbeatWrite): D1PreparedStatement[] {
  const up = hb.status === 1 ? 1 : 0;
  const down = hb.status === 0 ? 1 : 0;
  const hasLatency = up === 1 && hb.latencyMs != null;
  return [
    db
      .prepare(
        `INSERT INTO heartbeats (monitor_id, ts, status, latency_ms, msg, important)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM monitors WHERE id = ?1 AND active = 1)`,
      )
      .bind(hb.monitorId, hb.ts, hb.status, hb.latencyMs, hb.msg.slice(0, 1000), hb.important ? 1 : 0),
    db
      .prepare(
        `INSERT INTO daily_stats (monitor_id, day, up, down, latency_sum, latency_count)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM monitors WHERE id = ?1 AND active = 1)
         ON CONFLICT (monitor_id, day) DO UPDATE SET
           up = up + excluded.up,
           down = down + excluded.down,
           latency_sum = latency_sum + excluded.latency_sum,
           latency_count = latency_count + excluded.latency_count`,
      )
      .bind(hb.monitorId, hb.day, up, down, hasLatency ? hb.latencyMs : 0, hasLatency ? 1 : 0),
  ];
}

export async function listHeartbeats(
  db: D1Database,
  monitorId: number,
  limit: number,
  before?: number,
): Promise<Heartbeat[]> {
  const { results } = await db
    .prepare('SELECT * FROM heartbeats WHERE monitor_id = ? AND ts < ? ORDER BY ts DESC LIMIT ?')
    .bind(monitorId, before ?? Number.MAX_SAFE_INTEGER, limit)
    .all<HeartbeatRow>();
  return results.map(rowToHeartbeat);
}

export async function listImportantHeartbeats(db: D1Database, monitorId: number, limit: number): Promise<Heartbeat[]> {
  const { results } = await db
    .prepare('SELECT * FROM heartbeats WHERE monitor_id = ? AND important = 1 ORDER BY ts DESC LIMIT ?')
    .bind(monitorId, limit)
    .all<HeartbeatRow>();
  return results.map(rowToHeartbeat);
}

/** 每個 monitor 最近 limit 筆，舊到新。每個 monitor 一條查詢，走索引，避免全表掃描 */
export async function recentHeartbeats(
  db: D1Database,
  monitorIds: number[],
  limit: number,
): Promise<Map<number, Heartbeat[]>> {
  const map = new Map<number, Heartbeat[]>();
  if (monitorIds.length === 0) return map;
  const stmt = db.prepare('SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY ts DESC LIMIT ?');
  const results = await db.batch<HeartbeatRow>(monitorIds.map((id) => stmt.bind(id, limit)));
  monitorIds.forEach((id, i) => map.set(id, results[i]!.results.map(rowToHeartbeat).reverse()));
  return map;
}

export interface UptimeWindow {
  up: number;
  down: number;
  latencySum: number;
  latencyCount: number;
}

export async function uptimeSince(
  db: D1Database,
  monitorIds: number[],
  since: number,
): Promise<Map<number, UptimeWindow>> {
  const map = new Map<number, UptimeWindow>();
  if (monitorIds.length === 0) return map;
  const stmt = db.prepare(
    `SELECT
       COALESCE(SUM(status = 1), 0) AS up,
       COALESCE(SUM(status = 0), 0) AS down,
       COALESCE(SUM(CASE WHEN status = 1 THEN latency_ms END), 0) AS latency_sum,
       COUNT(CASE WHEN status = 1 THEN latency_ms END) AS latency_count
     FROM heartbeats WHERE monitor_id = ? AND ts >= ?`,
  );
  const results = await db.batch<{ up: number; down: number; latency_sum: number; latency_count: number }>(
    monitorIds.map((id) => stmt.bind(id, since)),
  );
  monitorIds.forEach((id, i) => {
    const r = results[i]!.results[0]!;
    map.set(id, { up: r.up, down: r.down, latencySum: r.latency_sum, latencyCount: r.latency_count });
  });
  return map;
}

/** 依 days（舊到新）補齊每天的統計，沒有資料的日子填 0 */
export async function dailyStats(
  db: D1Database,
  monitorIds: number[],
  days: string[],
): Promise<Map<number, DailyStat[]>> {
  const map = new Map<number, DailyStat[]>();
  if (monitorIds.length === 0 || days.length === 0) return map;
  const stmt = db.prepare('SELECT * FROM daily_stats WHERE monitor_id = ? AND day >= ?');
  const results = await db.batch<{
    monitor_id: number;
    day: string;
    up: number;
    down: number;
    latency_sum: number;
    latency_count: number;
  }>(monitorIds.map((id) => stmt.bind(id, days[0])));
  monitorIds.forEach((id, i) => {
    const byDay = new Map(results[i]!.results.map((r) => [r.day, r]));
    map.set(
      id,
      days.map((day) => {
        const r = byDay.get(day);
        return {
          day,
          up: r?.up ?? 0,
          down: r?.down ?? 0,
          avgLatencyMs: r && r.latency_count > 0 ? Math.round(r.latency_sum / r.latency_count) : null,
        };
      }),
    );
  });
  return map;
}

export function uptimeRatio(up: number, down: number): number | null {
  return up + down === 0 ? null : up / (up + down);
}

export function sumDaily(daily: DailyStat[], lastN: number): number | null {
  let up = 0;
  let down = 0;
  for (const d of daily.slice(-lastN)) {
    up += d.up;
    down += d.down;
  }
  return uptimeRatio(up, down);
}

export async function purgeOldData(
  db: D1Database,
  monitorIds: number[],
  heartbeatBefore: number,
  statsBeforeDay: string,
): Promise<void> {
  if (monitorIds.length === 0) return;
  // 逐個 monitor 刪，才能用 (monitor_id, ts) 索引；ts 單獨沒有索引
  const hb = db.prepare('DELETE FROM heartbeats WHERE monitor_id = ? AND ts < ?');
  const st = db.prepare('DELETE FROM daily_stats WHERE monitor_id = ? AND day < ?');
  await db.batch(monitorIds.flatMap((id) => [hb.bind(id, heartbeatBefore), st.bind(id, statsBeforeDay)]));
}

// ---------- notifications ----------

interface NotificationRow {
  id: number;
  name: string;
  type: 'discord';
  config: string;
  is_default: number;
  active: number;
  created_at: number;
  updated_at: number;
}

function rowToNotification(r: NotificationRow): NotificationChannel {
  const cfg = JSON.parse(r.config) as { webhookUrl?: string; username?: string };
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    webhookUrl: cfg.webhookUrl ?? '',
    username: cfg.username ?? '',
    isDefault: r.is_default === 1,
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listNotifications(db: D1Database): Promise<NotificationChannel[]> {
  const { results } = await db.prepare('SELECT * FROM notifications ORDER BY id').all<NotificationRow>();
  return results.map(rowToNotification);
}

export async function getNotification(db: D1Database, id: number): Promise<NotificationChannel | null> {
  const row = await db.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first<NotificationRow>();
  return row ? rowToNotification(row) : null;
}

export async function activeNotificationsForMonitor(db: D1Database, monitorId: number): Promise<NotificationChannel[]> {
  const { results } = await db
    .prepare(
      `SELECT n.* FROM notifications n
       JOIN monitor_notifications mn ON mn.notification_id = n.id
       WHERE mn.monitor_id = ? AND n.active = 1`,
    )
    .bind(monitorId)
    .all<NotificationRow>();
  return results.map(rowToNotification);
}

function notificationConfig(n: NotificationInput): string {
  return JSON.stringify({ webhookUrl: n.webhookUrl, username: n.username });
}

export async function insertNotification(db: D1Database, n: NotificationInput, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO notifications (name, type, config, is_default, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(n.name, n.type, notificationConfig(n), n.isDefault ? 1 : 0, n.active ? 1 : 0, now, now)
    .first<{ id: number }>();
  const id = row!.id;
  if (n.applyToAll) {
    await db
      .prepare('INSERT OR IGNORE INTO monitor_notifications (monitor_id, notification_id) SELECT id, ? FROM monitors')
      .bind(id)
      .run();
  }
  return id;
}

export async function updateNotification(
  db: D1Database,
  id: number,
  n: NotificationInput,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE notifications SET name = ?, type = ?, config = ?, is_default = ?, active = ?, updated_at = ? WHERE id = ?')
    .bind(n.name, n.type, notificationConfig(n), n.isDefault ? 1 : 0, n.active ? 1 : 0, now, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteNotification(db: D1Database, id: number): Promise<boolean> {
  const [res] = await db.batch([
    db.prepare('DELETE FROM notifications WHERE id = ?').bind(id),
    db.prepare('DELETE FROM monitor_notifications WHERE notification_id = ?').bind(id),
  ]);
  return (res!.meta.changes ?? 0) > 0;
}

// ---------- maintenances ----------

interface MaintenanceRow {
  id: number;
  title: string;
  description: string;
  strategy: MaintenanceStrategy;
  active: number;
  start_at: number | null;
  end_at: number | null;
  weekdays: string;
  start_time: string;
  end_time: string;
  timezone: string;
  created_at: number;
  updated_at: number;
}

function rowToMaintenance(r: MaintenanceRow, monitorIds: number[]): Maintenance {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    strategy: r.strategy,
    active: r.active === 1,
    startAt: r.start_at,
    endAt: r.end_at,
    weekdays: JSON.parse(r.weekdays) as number[],
    startTime: r.start_time,
    endTime: r.end_time,
    timezone: r.timezone,
    monitorIds,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listMaintenances(db: D1Database): Promise<Maintenance[]> {
  const [rows, links] = await db.batch<MaintenanceRow | { maintenance_id: number; monitor_id: number }>([
    db.prepare('SELECT * FROM maintenances ORDER BY id DESC'),
    db.prepare('SELECT maintenance_id, monitor_id FROM maintenance_monitors ORDER BY monitor_id'),
  ]);
  const byId = new Map<number, number[]>();
  for (const l of links!.results as { maintenance_id: number; monitor_id: number }[]) {
    const list = byId.get(l.maintenance_id) ?? [];
    list.push(l.monitor_id);
    byId.set(l.maintenance_id, list);
  }
  return (rows!.results as MaintenanceRow[]).map((r) => rowToMaintenance(r, byId.get(r.id) ?? []));
}

export async function getMaintenance(db: D1Database, id: number): Promise<Maintenance | null> {
  const [rows, links] = await db.batch<MaintenanceRow | { monitor_id: number }>([
    db.prepare('SELECT * FROM maintenances WHERE id = ?').bind(id),
    db.prepare('SELECT monitor_id FROM maintenance_monitors WHERE maintenance_id = ? ORDER BY monitor_id').bind(id),
  ]);
  const r = rows!.results[0] as MaintenanceRow | undefined;
  if (!r) return null;
  return rowToMaintenance(r, (links!.results as { monitor_id: number }[]).map((l) => l.monitor_id));
}

export async function maintenancesForMonitor(db: D1Database, monitorId: number): Promise<Maintenance[]> {
  const { results } = await db
    .prepare(
      `SELECT m.* FROM maintenances m
       JOIN maintenance_monitors mm ON mm.maintenance_id = m.id
       WHERE mm.monitor_id = ? ORDER BY m.id`,
    )
    .bind(monitorId)
    .all<MaintenanceRow>();
  return results.map((r) => rowToMaintenance(r, [monitorId]));
}

function maintenanceValues(m: MaintenanceInput): unknown[] {
  return [
    m.title,
    m.description,
    m.strategy,
    m.active ? 1 : 0,
    m.startAt,
    m.endAt,
    JSON.stringify(m.weekdays),
    m.startTime,
    m.endTime,
    m.timezone,
  ];
}

function maintenanceLinkStatements(db: D1Database, id: number, monitorIds: number[]): D1PreparedStatement[] {
  const stmts = [db.prepare('DELETE FROM maintenance_monitors WHERE maintenance_id = ?').bind(id)];
  for (const mid of new Set(monitorIds)) {
    stmts.push(
      db
        .prepare('INSERT INTO maintenance_monitors (maintenance_id, monitor_id) SELECT ?, id FROM monitors WHERE id = ?')
        .bind(id, mid),
    );
  }
  return stmts;
}

export async function insertMaintenance(db: D1Database, m: MaintenanceInput, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO maintenances (title, description, strategy, active, start_at, end_at, weekdays, start_time, end_time, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(...maintenanceValues(m), now, now)
    .first<{ id: number }>();
  const id = row!.id;
  await db.batch(maintenanceLinkStatements(db, id, m.monitorIds));
  return id;
}

export async function updateMaintenance(db: D1Database, id: number, m: MaintenanceInput, now: number): Promise<boolean> {
  const [res] = await db.batch([
    db
      .prepare(
        `UPDATE maintenances SET title = ?, description = ?, strategy = ?, active = ?, start_at = ?, end_at = ?,
         weekdays = ?, start_time = ?, end_time = ?, timezone = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(...maintenanceValues(m), now, id),
    ...maintenanceLinkStatements(db, id, m.monitorIds),
  ]);
  return (res!.meta.changes ?? 0) > 0;
}

export async function deleteMaintenance(db: D1Database, id: number): Promise<boolean> {
  const [res] = await db.batch([
    db.prepare('DELETE FROM maintenances WHERE id = ?').bind(id),
    db.prepare('DELETE FROM maintenance_monitors WHERE maintenance_id = ?').bind(id),
  ]);
  return (res!.meta.changes ?? 0) > 0;
}

// ---------- incidents ----------

interface IncidentRow {
  id: number;
  title: string;
  content: string;
  style: IncidentStyle;
  pinned: number;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}

function rowToIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    style: r.style,
    pinned: r.pinned === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

export async function listIncidents(db: D1Database): Promise<Incident[]> {
  const { results } = await db
    .prepare('SELECT * FROM incidents ORDER BY resolved_at IS NOT NULL, pinned DESC, created_at DESC')
    .all<IncidentRow>();
  return results.map(rowToIncident);
}

/** 狀態頁用：未解決的全部 + resolvedSince 之後解決的 */
export async function listPublicIncidents(db: D1Database, resolvedSince: number): Promise<Incident[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM incidents WHERE resolved_at IS NULL OR resolved_at >= ?
       ORDER BY resolved_at IS NOT NULL, pinned DESC, created_at DESC`,
    )
    .bind(resolvedSince)
    .all<IncidentRow>();
  return results.map(rowToIncident);
}

export async function getIncident(db: D1Database, id: number): Promise<Incident | null> {
  const row = await db.prepare('SELECT * FROM incidents WHERE id = ?').bind(id).first<IncidentRow>();
  return row ? rowToIncident(row) : null;
}

export async function insertIncident(db: D1Database, i: IncidentInput, now: number): Promise<number> {
  const row = await db
    .prepare(
      'INSERT INTO incidents (title, content, style, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .bind(i.title, i.content, i.style, i.pinned ? 1 : 0, now, now)
    .first<{ id: number }>();
  return row!.id;
}

export async function updateIncident(db: D1Database, id: number, i: IncidentInput, now: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE incidents SET title = ?, content = ?, style = ?, pinned = ?, updated_at = ? WHERE id = ?')
    .bind(i.title, i.content, i.style, i.pinned ? 1 : 0, now, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function resolveIncident(db: D1Database, id: number, now: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE incidents SET resolved_at = COALESCE(resolved_at, ?), updated_at = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteIncident(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM incidents WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- settings ----------

export const DEFAULT_SETTINGS: Settings = {
  title: '服務狀態',
  description: '',
  footer: '',
  timezone: 'Asia/Taipei',
  heartbeatRetentionDays: 30,
  statsRetentionDays: 365,
};

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const stored: Record<string, unknown> = {};
  for (const r of results) stored[r.key] = JSON.parse(r.value);
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (typeof stored[key] === typeof DEFAULT_SETTINGS[key]) (settings as Record<string, unknown>)[key] = stored[key];
  }
  return settings;
}

export async function putSettings(db: D1Database, s: Settings): Promise<void> {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  await db.batch(Object.entries(s).map(([k, v]) => stmt.bind(k, JSON.stringify(v))));
}

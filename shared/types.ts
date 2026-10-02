// 前後端共用的 API 型別。時間一律是 epoch 毫秒。

export const STATUS = {
  DOWN: 0,
  UP: 1,
  PENDING: 2,
  MAINTENANCE: 3,
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

export type MonitorType = 'http' | 'push';
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface MonitorInput {
  name: string;
  type: MonitorType;
  active: boolean;
  intervalS: number;
  retryIntervalS: number;
  retries: number;
  /** 連續 down 每 N 次重送通知，0 = 不重送 */
  resendInterval: number;
  upsideDown: boolean;
  description: string;
  isPublic: boolean;
  groupName: string;
  sortOrder: number;
  // HTTP
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body: string;
  /** 例：["200-299", "301"] */
  acceptedCodes: string[];
  keyword: string;
  invertKeyword: boolean;
  timeoutS: number;
  maxRedirects: number;
  /** 省略時，新增 monitor 會套用 isDefault 的通知 */
  notificationIds?: number[];
}

export interface Monitor extends Omit<MonitorInput, 'notificationIds'> {
  id: number;
  pushToken: string | null;
  notificationIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface Heartbeat {
  id: number;
  monitorId: number;
  ts: number;
  status: Status;
  latencyMs: number | null;
  msg: string;
  important: boolean;
}

/** GET /api/admin/monitors 的每一筆 */
export interface MonitorSummary extends Monitor {
  lastStatus: Status | null;
  lastBeatAt: number | null;
  lastLatencyMs: number | null;
  lastMsg: string | null;
  uptime24h: number | null;
  /** 最近的心跳，舊到新，最多 30 筆 */
  recent: Heartbeat[];
}

export interface DailyStat {
  /** YYYY-MM-DD（設定的時區） */
  day: string;
  up: number;
  down: number;
  avgLatencyMs: number | null;
}

/** GET /api/admin/monitors/:id/stats */
export interface MonitorStats {
  uptime24h: number | null;
  uptime30d: number | null;
  uptime90d: number | null;
  avgLatency24h: number | null;
  /** 90 天，舊到新；沒有資料的日子 up=down=0 */
  daily: DailyStat[];
}

export interface NotificationInput {
  name: string;
  type: 'discord';
  webhookUrl: string;
  /** Discord 顯示名稱，空字串 = 用 webhook 預設 */
  username: string;
  isDefault: boolean;
  active: boolean;
  /** 新增時一併套用到所有現有 monitor */
  applyToAll?: boolean;
}

export interface NotificationChannel extends Omit<NotificationInput, 'applyToAll'> {
  id: number;
  createdAt: number;
  updatedAt: number;
}

export type MaintenanceStrategy = 'manual' | 'single' | 'weekly';

export interface MaintenanceInput {
  title: string;
  description: string;
  strategy: MaintenanceStrategy;
  active: boolean;
  /** single 用 */
  startAt: number | null;
  endAt: number | null;
  /** weekly 用：0=週日 … 6=週六 */
  weekdays: number[];
  /** weekly 用：HH:MM；endTime <= startTime 代表跨午夜 */
  startTime: string;
  endTime: string;
  /** IANA 時區，例 Asia/Taipei */
  timezone: string;
  monitorIds: number[];
}

export interface Maintenance extends MaintenanceInput {
  id: number;
  createdAt: number;
  updatedAt: number;
}

export interface MaintenanceWindow {
  start: number;
  /** manual 沒有結束時間 */
  end: number | null;
}

export interface MaintenanceWithState extends Maintenance {
  inProgress: boolean;
  /** 進行中 = 目前這段；否則 = 下一段；沒有則 null */
  window: MaintenanceWindow | null;
}

export type IncidentStyle = 'info' | 'warning' | 'danger';

export interface IncidentInput {
  title: string;
  /** Markdown */
  content: string;
  style: IncidentStyle;
  pinned: boolean;
}

export interface Incident extends IncidentInput {
  id: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface Settings {
  title: string;
  description: string;
  /** 狀態頁底部文字（純文字） */
  footer: string;
  timezone: string;
  heartbeatRetentionDays: number;
  statsRetentionDays: number;
}

export interface PublicHeartbeat {
  ts: number;
  status: Status;
  latencyMs: number | null;
  msg: string;
}

export interface PublicMonitor {
  id: number;
  name: string;
  description: string;
  type: MonitorType;
  status: Status | null;
  uptime24h: number | null;
  uptime30d: number | null;
  uptime90d: number | null;
  /** 舊到新，最多 50 筆 */
  recent: PublicHeartbeat[];
  /** 90 天，舊到新 */
  daily: DailyStat[];
}

export interface PublicMaintenance {
  id: number;
  title: string;
  description: string;
  inProgress: boolean;
  window: MaintenanceWindow | null;
  monitorIds: number[];
}

export type OverallStatus = 'up' | 'degraded' | 'down' | 'maintenance' | 'unknown';

/** GET /api/status */
export interface PublicStatus {
  title: string;
  description: string;
  footer: string;
  timezone: string;
  generatedAt: number;
  overall: OverallStatus;
  /** 未解決的在前（pinned 優先），再來是 7 天內已解決的 */
  incidents: Incident[];
  /** 進行中、或 24 小時內會開始 */
  maintenances: PublicMaintenance[];
  groups: { name: string; monitors: PublicMonitor[] }[];
}

export interface ApiError {
  error: string;
}

/*
API 路由一覽（JSON；錯誤回 4xx/5xx + ApiError）

公開
  GET  /api/status                          -> PublicStatus
  ANY  /api/push/:token?status=up|down&msg=&ping=
                                            -> {ok:true} | 404 {ok:false,msg}

管理（Cloudflare Access 保護）
  GET    /api/admin/me                      -> { email: string }
  GET    /api/admin/monitors                -> MonitorSummary[]
  POST   /api/admin/monitors                (MonitorInput) -> Monitor
  GET    /api/admin/monitors/:id            -> Monitor
  PUT    /api/admin/monitors/:id            (MonitorInput) -> Monitor
  DELETE /api/admin/monitors/:id            -> { ok: true }
  POST   /api/admin/monitors/:id/pause      -> Monitor
  POST   /api/admin/monitors/:id/resume     -> Monitor
  POST   /api/admin/monitors/:id/regenerate-token -> Monitor
  GET    /api/admin/monitors/:id/heartbeats?limit=100&before=<ts> -> Heartbeat[]（新到舊）
  GET    /api/admin/monitors/:id/events?limit=50 -> Heartbeat[]（important，新到舊）
  GET    /api/admin/monitors/:id/stats      -> MonitorStats

  GET    /api/admin/notifications           -> NotificationChannel[]
  POST   /api/admin/notifications           (NotificationInput) -> NotificationChannel
  PUT    /api/admin/notifications/:id       (NotificationInput) -> NotificationChannel
  DELETE /api/admin/notifications/:id       -> { ok: true }
  POST   /api/admin/notifications/test      ({ webhookUrl, username }) -> { ok: true } | ApiError

  GET    /api/admin/maintenances            -> MaintenanceWithState[]
  POST   /api/admin/maintenances            (MaintenanceInput) -> Maintenance
  PUT    /api/admin/maintenances/:id        (MaintenanceInput) -> Maintenance
  DELETE /api/admin/maintenances/:id        -> { ok: true }

  GET    /api/admin/incidents               -> Incident[]（新到舊）
  POST   /api/admin/incidents               (IncidentInput) -> Incident
  PUT    /api/admin/incidents/:id           (IncidentInput) -> Incident
  POST   /api/admin/incidents/:id/resolve   -> Incident
  DELETE /api/admin/incidents/:id           -> { ok: true }

  GET    /api/admin/settings                -> Settings
  PUT    /api/admin/settings                (Settings) -> Settings

push URL = `${location.origin}/api/push/${pushToken}`
*/

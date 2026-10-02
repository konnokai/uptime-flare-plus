-- 不用 FOREIGN KEY：刪 monitor 時由程式一起清，避免 D1 cascade 一次刪大量心跳拖慢請求
CREATE TABLE monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'push')),
  active INTEGER NOT NULL DEFAULT 1,
  interval_s INTEGER NOT NULL DEFAULT 60,
  retry_interval_s INTEGER NOT NULL DEFAULT 60,
  retries INTEGER NOT NULL DEFAULT 0,
  resend_interval INTEGER NOT NULL DEFAULT 0,
  upside_down INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  group_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'GET',
  headers TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  accepted_codes TEXT NOT NULL DEFAULT '["200-299"]',
  keyword TEXT NOT NULL DEFAULT '',
  invert_keyword INTEGER NOT NULL DEFAULT 0,
  timeout_s INTEGER NOT NULL DEFAULT 30,
  max_redirects INTEGER NOT NULL DEFAULT 10,
  push_token TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  status INTEGER NOT NULL,
  latency_ms INTEGER,
  msg TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_heartbeats_monitor_ts ON heartbeats (monitor_id, ts DESC);
-- 事件列表用；只收狀態改變的列，寫入成本很小
CREATE INDEX idx_heartbeats_important ON heartbeats (monitor_id, ts DESC) WHERE important = 1;

CREATE TABLE daily_stats (
  monitor_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  latency_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day)
) WITHOUT ROWID;

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'discord',
  config TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE monitor_notifications (
  monitor_id INTEGER NOT NULL,
  notification_id INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, notification_id)
) WITHOUT ROWID;

CREATE TABLE maintenances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL CHECK (strategy IN ('manual', 'single', 'weekly')),
  active INTEGER NOT NULL DEFAULT 1,
  start_at INTEGER,
  end_at INTEGER,
  weekdays TEXT NOT NULL DEFAULT '[]',
  start_time TEXT NOT NULL DEFAULT '00:00',
  end_time TEXT NOT NULL DEFAULT '00:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE maintenance_monitors (
  maintenance_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  PRIMARY KEY (maintenance_id, monitor_id)
) WITHOUT ROWID;
CREATE INDEX idx_maintenance_monitors_monitor ON maintenance_monitors (monitor_id);

CREATE TABLE incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'info' CHECK (style IN ('info', 'warning', 'danger')),
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

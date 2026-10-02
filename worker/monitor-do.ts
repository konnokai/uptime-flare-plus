import { DurableObject } from 'cloudflare:workers';
import { STATUS, type Monitor, type Status } from '../shared/types';
import { checkHttp } from './checks/http';
import {
  activeNotificationsForMonitor,
  getMonitor,
  getSettings,
  maintenancesForMonitor,
  writeHeartbeat,
} from './db';
import type { Env } from './env';
import { inMaintenance, type MaintenanceRule } from './maintenance';
import { sendDiscord, statusMessage } from './notify/discord';
import { dayKey } from './time';

/** Kuma 的做法：push 逾時判斷多給 1 秒緩衝，避免剛好在邊界上的 push 被判逾時 */
export const PUSH_BUFFER_MS = 1000;
const FIRST_CHECK_DELAY_MS = 1000;

export interface MonitorConfig {
  monitorId: number;
  /** 設定內容的指紋；watchdog 用它判斷要不要重新排程 */
  version: string;
  monitor: Monitor;
  maintenances: MaintenanceRule[];
  timezone: string;
}

export interface MonitorState {
  status: Status | null;
  /** 已用掉的 retries */
  retries: number;
  /** 連續 down 的次數（不含第一次），給重送通知用 */
  downCount: number;
  lastPushAt: number | null;
}

export interface PushInput {
  status: 'up' | 'down';
  msg: string;
  ping: number | null;
}

const INITIAL_STATE: MonitorState = { status: null, retries: 0, downCount: 0, lastPushAt: null };

export class MonitorDO extends DurableObject<Env> {
  private get config(): MonitorConfig | undefined {
    return this.ctx.storage.kv.get<MonitorConfig>('config');
  }

  private get state(): MonitorState {
    return this.ctx.storage.kv.get<MonitorState>('state') ?? { ...INITIAL_STATE };
  }

  private configureQueue: Promise<unknown> = Promise.resolve();

  /** 從 D1 重新載入設定。設定沒變且 alarm 還在時不動排程 */
  configure(monitorId: number): Promise<{ changed: boolean }> {
    // 排隊執行：讀 D1 時 input gate 是開的，watchdog 讀到的舊設定可能蓋掉管理端剛寫的新設定。
    // 排隊後，後到的呼叫一定在前一個寫完之後才讀 D1。
    const run = this.configureQueue.then(() => this.doConfigure(monitorId));
    this.configureQueue = run.catch(() => {});
    return run;
  }

  private async doConfigure(monitorId: number): Promise<{ changed: boolean }> {
    const monitor = await getMonitor(this.env.DB, monitorId);
    if (!monitor) {
      await this.destroy();
      return { changed: true };
    }
    const [maintenances, settings] = await Promise.all([
      maintenancesForMonitor(this.env.DB, monitorId),
      getSettings(this.env.DB),
    ]);
    const rules: MaintenanceRule[] = maintenances.map((m) => ({
      strategy: m.strategy,
      active: m.active,
      startAt: m.startAt,
      endAt: m.endAt,
      weekdays: m.weekdays,
      startTime: m.startTime,
      endTime: m.endTime,
      timezone: m.timezone,
    }));
    const version = JSON.stringify([monitor.updatedAt, monitor.active, rules, settings.timezone]);
    const prev = this.config;
    const changed = prev?.version !== version;
    const next: MonitorConfig = { monitorId, version, monitor, maintenances: rules, timezone: settings.timezone };
    // watchdog 每 5 分鐘會呼叫一次，沒變就不寫，省 DO 寫入
    if (changed) this.ctx.storage.kv.put('config', next);

    if (!monitor.active) {
      if (changed) this.ctx.storage.kv.put('state', { ...this.state, retries: 0, downCount: 0 });
      await this.ctx.storage.deleteAlarm();
      return { changed };
    }

    const hasAlarm = (await this.ctx.storage.getAlarm()) !== null;
    if (!hasAlarm) {
      await this.ctx.storage.setAlarm(this.initialAlarmTime(next));
    } else if (changed && this.shouldReschedule(prev, next)) {
      await this.ctx.storage.setAlarm(this.initialAlarmTime(next));
    }
    return { changed };
  }

  /**
   * HTTP：設定改了就馬上檢查一次。
   * Push：只有間隔改了或剛恢復啟用才重排；改維護時段、時區、token 不該把逾時期限往後推。
   */
  private shouldReschedule(prev: MonitorConfig | undefined, next: MonitorConfig): boolean {
    if (next.monitor.type === 'http') return true;
    if (!prev || !prev.monitor.active) return true;
    return (
      prev.monitor.intervalS !== next.monitor.intervalS || prev.monitor.retryIntervalS !== next.monitor.retryIntervalS
    );
  }

  private initialAlarmTime(cfg: MonitorConfig): number {
    const now = Date.now();
    if (cfg.monitor.type === 'http') return now + FIRST_CHECK_DELAY_MS;
    const state = this.state;
    const intervalMs = cfg.monitor.intervalS * 1000;
    if (state.lastPushAt !== null && state.status === STATUS.UP) {
      return Math.max(now + FIRST_CHECK_DELAY_MS, state.lastPushAt + intervalMs + PUSH_BUFFER_MS);
    }
    // 還沒收過 push 或目前不是 up：從現在給一整個間隔，免得馬上被判逾時
    return now + intervalMs + PUSH_BUFFER_MS;
  }

  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async getSnapshot(): Promise<{ config: MonitorConfig | null; state: MonitorState; alarm: number | null }> {
    return { config: this.config ?? null, state: this.state, alarm: await this.ctx.storage.getAlarm() };
  }

  async push(input: PushInput): Promise<boolean> {
    const cfg = this.config;
    if (!cfg || !cfg.monitor.active || cfg.monitor.type !== 'push') return false;
    const now = Date.now();
    this.ctx.storage.kv.put('state', { ...this.state, lastPushAt: now });
    const nextAt = now + cfg.monitor.intervalS * 1000 + PUSH_BUFFER_MS;

    if (inMaintenance(cfg.maintenances, now)) {
      await this.transition(cfg, STATUS.MAINTENANCE, input.ping, input.msg, nextAt, now);
      return true;
    }
    const up = (input.status === 'up') !== cfg.monitor.upsideDown;
    // 服務自己回報 down 就直接判定，不走 retries（跟 Kuma 一樣）
    await this.transition(cfg, up ? STATUS.UP : STATUS.DOWN, input.ping, input.msg, nextAt, now);
    return true;
  }

  async alarm(): Promise<void> {
    const cfg = this.config;
    if (!cfg || !cfg.monitor.active) return;
    const m = cfg.monitor;
    const now = Date.now();

    if (inMaintenance(cfg.maintenances, now)) {
      await this.transition(cfg, STATUS.MAINTENANCE, null, 'Under maintenance', now + m.intervalS * 1000, now);
      return;
    }

    if (m.type === 'push') {
      // 反向模式下「沒收到 push」才是正常
      if (m.upsideDown) {
        await this.transition(cfg, STATUS.UP, null, 'No push received (upside down)', now + m.intervalS * 1000, now);
      } else {
        await this.fail(cfg, 'No heartbeat in the time window', null, now);
      }
      return;
    }

    const result = await checkHttp(m);
    // 檢查期間設定被改過：configure() 已經重排 alarm，這次結果作廢
    if (this.config?.version !== cfg.version) return;
    const finished = Date.now();
    const ok = result.ok !== m.upsideDown;
    if (ok) {
      await this.transition(cfg, STATUS.UP, result.latencyMs, result.msg, finished + m.intervalS * 1000, finished);
    } else {
      await this.fail(cfg, result.msg, result.latencyMs, finished);
    }
  }

  /** 失敗時依 retries 決定 pending 或 down */
  private async fail(cfg: MonitorConfig, msg: string, latencyMs: number | null, now: number): Promise<void> {
    const m = cfg.monitor;
    const state = this.state;
    if (state.status !== STATUS.DOWN && state.retries < m.retries) {
      const retryMs = (m.retryIntervalS || m.intervalS) * 1000;
      await this.transition(cfg, STATUS.PENDING, latencyMs, msg, now + retryMs, now);
      return;
    }
    await this.transition(cfg, STATUS.DOWN, latencyMs, msg, now + m.intervalS * 1000, now);
  }

  private async transition(
    cfg: MonitorConfig,
    status: Status,
    latencyMs: number | null,
    msg: string,
    nextAlarmAt: number,
    now: number,
  ): Promise<void> {
    const m = cfg.monitor;
    const prev = this.state;
    const next: MonitorState = {
      status,
      retries: status === STATUS.PENDING ? prev.retries + 1 : status === STATUS.DOWN ? prev.retries : 0,
      downCount: status === STATUS.DOWN && prev.status === STATUS.DOWN ? prev.downCount + 1 : 0,
      lastPushAt: prev.lastPushAt,
    };
    // 先寫狀態和下一次 alarm，再做 D1 / Discord 這些外部 I/O，
    // 這樣中途插進來的 push 看到的是新狀態，不會被舊結果蓋掉
    this.ctx.storage.kv.put('state', next);
    await this.ctx.storage.setAlarm(nextAlarmAt);

    let exists = true;
    try {
      exists = await writeHeartbeat(this.env.DB, {
        monitorId: cfg.monitorId,
        ts: now,
        status,
        latencyMs: latencyMs === null ? null : Math.round(latencyMs),
        msg,
        important: prev.status !== status,
        day: dayKey(now, cfg.timezone),
      });
    } catch (err) {
      // 不往外丟：alarm 失敗會被系統重試，造成重複心跳
      console.error('writeHeartbeat failed', cfg.monitorId, err);
    }
    if (!exists) {
      // monitor 已被刪除或停用，但這個 DO 沒收到通知；停掉排程，等 configure 決定。
      // 等 D1 的期間若有新的 configure（例如暫停後又恢復），它排的 alarm 要保留
      if (this.config?.version === cfg.version) await this.ctx.storage.deleteAlarm();
      return;
    }

    const wentDown = status === STATUS.DOWN && prev.status !== STATUS.DOWN;
    const resend =
      status === STATUS.DOWN &&
      prev.status === STATUS.DOWN &&
      m.resendInterval > 0 &&
      next.downCount % m.resendInterval === 0;
    const recovered = status === STATUS.UP && prev.status === STATUS.DOWN;
    if (wentDown || resend || recovered) {
      await this.notify(cfg, { status, msg, latencyMs, ts: now, resend });
    }
  }

  private async notify(
    cfg: MonitorConfig,
    info: { status: Status; msg: string; latencyMs: number | null; ts: number; resend: boolean },
  ): Promise<void> {
    try {
      const channels = await activeNotificationsForMonitor(this.env.DB, cfg.monitorId);
      const payload = statusMessage({
        monitorName: cfg.monitor.name,
        target: cfg.monitor.type === 'http' ? cfg.monitor.url : 'Push',
        timezone: cfg.timezone,
        ...info,
      });
      const results = await Promise.allSettled(channels.map((c) => sendDiscord(c, payload)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error('Discord notify failed', channels[i]!.id, r.reason);
      });
    } catch (err) {
      console.error('notify failed', cfg.monitorId, err);
    }
  }
}

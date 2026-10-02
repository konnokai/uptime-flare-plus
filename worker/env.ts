import type { MonitorDO } from './monitor-do';

export interface Env {
  DB: D1Database;
  MONITOR: DurableObjectNamespace<MonitorDO>;
  ASSETS: Fetcher;
  /** 例：https://myteam.cloudflareaccess.com，或只寫 myteam */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access application 的 AUD tag；多個用逗號分隔 */
  ACCESS_AUD?: string;
  /** 只在 localhost 生效 */
  ACCESS_DEV_BYPASS?: string;
}

export function monitorStub(env: Env, monitorId: number) {
  return env.MONITOR.getByName(String(monitorId));
}

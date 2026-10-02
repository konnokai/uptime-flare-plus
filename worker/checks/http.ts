import type { HttpMethod } from '../../shared/types';

export interface HttpCheckConfig {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body: string;
  acceptedCodes: string[];
  keyword: string;
  invertKeyword: boolean;
  timeoutS: number;
  maxRedirects: number;
}

export interface CheckResult {
  ok: boolean;
  latencyMs: number | null;
  msg: string;
}

// 關鍵字比對只讀前 1 MB，避免大檔案吃光記憶體
const KEYWORD_READ_LIMIT = 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export function matchesAcceptedCodes(status: number, accepted: string[]): boolean {
  return accepted.some((rule) => {
    const [lo, hi] = rule.split('-').map((s) => Number(s.trim()));
    if (lo === undefined || Number.isNaN(lo)) return false;
    return hi === undefined ? status === lo : status >= lo && status <= hi;
  });
}

async function readText(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text + decoder.decode();
}

export async function checkHttp(
  cfg: HttpCheckConfig,
  fetcher: typeof fetch = fetch,
): Promise<CheckResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(cfg.timeoutS * 1000);
  let url = cfg.url;
  let method: string = cfg.method;
  let body: string | undefined = method === 'GET' || method === 'HEAD' ? undefined : cfg.body || undefined;

  try {
    for (let redirects = 0; ; redirects++) {
      const res = await fetcher(url, {
        method,
        headers: cfg.headers,
        body,
        redirect: 'manual',
        signal,
        cache: 'no-store',
      });
      const location = res.headers.get('location');
      if (REDIRECT_CODES.has(res.status) && location && redirects < cfg.maxRedirects) {
        await res.body?.cancel();
        url = new URL(location, url).toString();
        // 跟瀏覽器一致：303，或 POST 遇到 301/302，改成 GET 並丟掉 body
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }

      const latencyMs = Date.now() - started;
      const statusText = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
      if (!matchesAcceptedCodes(res.status, cfg.acceptedCodes)) {
        await res.body?.cancel();
        return { ok: false, latencyMs, msg: `Status code ${statusText}` };
      }
      if (!cfg.keyword) {
        await res.body?.cancel();
        return { ok: true, latencyMs, msg: statusText };
      }
      const text = await readText(res, KEYWORD_READ_LIMIT);
      const found = text.includes(cfg.keyword);
      if (found === cfg.invertKeyword) {
        // 不把關鍵字本身寫進訊息：訊息會出現在公開狀態頁
        return { ok: false, latencyMs, msg: `${statusText}, keyword ${found ? 'found' : 'not found'}` };
      }
      return { ok: true, latencyMs, msg: `${statusText}, keyword ${found ? 'found' : 'absent'}` };
    }
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (signal.aborted) return { ok: false, latencyMs, msg: `Timeout after ${cfg.timeoutS}s` };
    return { ok: false, latencyMs, msg: err instanceof Error ? err.message : String(err) };
  }
}

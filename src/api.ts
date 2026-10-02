import type { ApiError } from '../shared/types';

export const AUTH_MESSAGE = '沒有權限，請透過 Cloudflare Access 登入';

export class RequestError extends Error {
  readonly status: number;
  /** 401/403，或被 Access 導去登入頁 */
  readonly auth: boolean;

  constructor(message: string, status: number, auth = false) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.auth = auth;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const isAdmin = path.startsWith('/api/admin');
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: hasBody ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Access 登入過期時會轉址到其他網域，fetch 會在 CORS 這一步失敗
    throw new RequestError(
      isAdmin ? '無法連線到伺服器。如果登入已過期，請重新整理頁面。' : '無法連線到伺服器，請稍後再試。',
      0,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new RequestError(AUTH_MESSAGE, res.status, true);
  }

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    // 200 卻回 HTML，通常是 Access 的登入頁
    if (res.ok && isAdmin && type.includes('text/html')) {
      throw new RequestError(AUTH_MESSAGE, res.status, true);
    }
    throw new RequestError(res.ok ? '伺服器回應格式不正確' : `伺服器錯誤（${res.status}）`, res.status);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new RequestError('伺服器回應格式不正確', res.status);
  }

  if (!res.ok) {
    const msg = (data as Partial<ApiError> | null)?.error;
    throw new RequestError(typeof msg === 'string' && msg ? msg : `伺服器錯誤（${res.status}）`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return '發生未知錯誤';
}

export function isAuthError(err: unknown): boolean {
  return err instanceof RequestError && err.auth;
}

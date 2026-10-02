import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from '../env';

export type AdminVariables = { email: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const jwksCache = new Map<string, JWTVerifyGetKey>();

/** 接受 "myteam"、"myteam.cloudflareaccess.com" 或完整 URL */
export function normalizeTeamDomain(value: string): string {
  let v = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(v)) v = v.includes('.') ? `https://${v}` : `https://${v}.cloudflareaccess.com`;
  return v;
}

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Access 已在邊緣擋掉未登入的人；這裡再驗一次 JWT，
 * 防止有人繞過 Access 直接打到 Worker（例如 workers.dev 網址）。
 */
export function accessAuth(options: { getKey?: JWTVerifyGetKey } = {}): MiddlewareHandler<{
  Bindings: Env;
  Variables: AdminVariables;
}> {
  return async (c, next) => {
    const env = c.env;
    if (env.ACCESS_DEV_BYPASS === 'true' && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      c.set('email', 'dev@localhost');
      return next();
    }
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
      return c.json({ error: 'Cloudflare Access is not configured' }, 403);
    }
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) return c.json({ error: 'Missing Cloudflare Access token' }, 403);

    const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
    try {
      const { payload } = await jwtVerify(token, options.getKey ?? remoteJwks(teamDomain), {
        issuer: teamDomain,
        // 用逗號分隔可以接受多個 Access application 的 AUD
        audience: env.ACCESS_AUD.split(',').map((s) => s.trim()).filter(Boolean),
      });
      c.set('email', typeof payload.email === 'string' ? payload.email : String(payload.sub ?? ''));
    } catch {
      return c.json({ error: 'Invalid Cloudflare Access token' }, 403);
    }
    return next();
  };
}

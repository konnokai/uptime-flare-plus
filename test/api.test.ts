import { SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { Incident, PublicStatus, Settings } from '../shared/types';
import { accessAuth, normalizeTeamDomain } from '../worker/auth/access';
import type { Env } from '../worker/env';
import { api, createMonitor } from './helpers';

describe('admin auth', () => {
  it('rejects admin API from non-local host without Access token', async () => {
    const res = await SELF.fetch('https://status.example.com/api/admin/monitors');
    expect(res.status).toBe(403);
  });

  it('rejects cross-site writes', async () => {
    const res = await api('/api/admin/incidents', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
      json: { title: 'x' },
    });
    expect(res.status).toBe(403);
    const fetchSite = await api('/api/admin/incidents', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
      json: { title: 'x' },
    });
    expect(fetchSite.status).toBe(403);
    const same = await api<Incident>('/api/admin/incidents', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      json: { title: 'ok' },
    });
    expect(same.status).toBe(201);
    // D1 在測試之間不會重置，刪掉免得影響狀態頁的測試
    await api(`/api/admin/incidents/${same.body.id}`, { method: 'DELETE' });
  });

  it('normalizes team domain', () => {
    expect(normalizeTeamDomain('myteam')).toBe('https://myteam.cloudflareaccess.com');
    expect(normalizeTeamDomain('https://myteam.cloudflareaccess.com/')).toBe('https://myteam.cloudflareaccess.com');
  });

  it('verifies Access JWT issuer and audience', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const getKey = createLocalJWKSet({ keys: [jwk] });
    const app = new Hono<{ Bindings: Env; Variables: { email: string } }>();
    app.use('*', accessAuth({ getKey }));
    app.get('/', (c) => c.json({ email: c.get('email') }));
    const env = { ACCESS_TEAM_DOMAIN: 'myteam', ACCESS_AUD: 'aud-1' } as Env;
    const sign = (aud: string) =>
      new SignJWT({ email: 'me@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://myteam.cloudflareaccess.com')
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    const withToken = async (aud: string) => ({ headers: { 'cf-access-jwt-assertion': await sign(aud) } });

    const ok = await app.request('https://x.test/', await withToken('aud-1'), env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: 'me@example.com' });

    expect((await app.request('https://x.test/', await withToken('other'), env)).status).toBe(403);
    const multi = { ...env, ACCESS_AUD: 'aud-0, aud-1' } as Env;
    expect((await app.request('https://x.test/', await withToken('aud-1'), multi)).status).toBe(200);
    expect((await app.request('https://x.test/', {}, env)).status).toBe(403);
    // 沒設定 Access 時一律拒絕
    expect((await app.request('https://x.test/', await withToken('aud-1'), {} as Env)).status).toBe(403);
  });
});

describe('validation', () => {
  it('rejects bad monitor input', async () => {
    const res = await api<{ error: string }>('/api/admin/monitors', {
      method: 'POST',
      json: { name: 'x', type: 'http', url: 'ftp://nope' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('http');
    const short = await api('/api/admin/monitors', { method: 'POST', json: { name: 'x', type: 'push', intervalS: 5 } });
    expect(short.status).toBe(400);
  });

  it('rejects non-Discord webhook', async () => {
    const res = await api('/api/admin/notifications', {
      method: 'POST',
      json: { name: 'x', webhookUrl: 'https://evil.test/hook' },
    });
    expect(res.status).toBe(400);
  });
});

describe('settings and status page', () => {
  it('returns defaults and saves settings', async () => {
    const def = await api<Settings>('/api/admin/settings');
    expect(def.body.timezone).toBe('Asia/Taipei');
    const saved = await api<Settings>('/api/admin/settings', {
      method: 'PUT',
      json: { ...def.body, title: 'My Status' },
    });
    expect(saved.body.title).toBe('My Status');
    const bad = await api('/api/admin/settings', { method: 'PUT', json: { ...def.body, timezone: 'Mars/Base' } });
    expect(bad.status).toBe(400);
  });

  it('shows public monitors, incidents and maintenances', async () => {
    const pub = await createMonitor({ type: 'push', name: 'api', groupName: 'Core' });
    await createMonitor({ type: 'push', name: 'secret', isPublic: false });
    const inc = await api<Incident>('/api/admin/incidents', {
      method: 'POST',
      json: { title: '資料庫延遲', content: '**調查中**', style: 'warning' },
    });
    const old = await api<Incident>('/api/admin/incidents', { method: 'POST', json: { title: 'old', content: '' } });
    await api(`/api/admin/incidents/${old.body.id}/resolve`, { method: 'POST' });
    await api('/api/admin/maintenances', {
      method: 'POST',
      json: {
        title: 'soon',
        strategy: 'single',
        startAt: Date.now() + 3_600_000,
        endAt: Date.now() + 7_200_000,
        monitorIds: [pub.id],
      },
    });
    await api('/api/admin/maintenances', {
      method: 'POST',
      json: { title: 'far', strategy: 'single', startAt: Date.now() + 5 * 86_400_000, endAt: Date.now() + 6 * 86_400_000 },
    });

    const res = await SELF.fetch('http://localhost/api/status');
    expect(res.headers.get('cache-control')).toContain('max-age=30');
    const status = (await res.json()) as PublicStatus;
    const names = status.groups.flatMap((g) => g.monitors.map((m) => m.name));
    expect(names).toContain('api');
    expect(names).not.toContain('secret');
    expect(status.groups.find((g) => g.name === 'Core')!.monitors[0]!.daily).toHaveLength(90);
    expect(status.incidents.map((i) => i.title)).toEqual(['資料庫延遲', 'old']);
    expect(status.incidents[0]!.id).toBe(inc.body.id);
    expect(status.maintenances.map((m) => m.title)).toEqual(['soon']);
    expect(status.maintenances[0]!.inProgress).toBe(false);
  });
});

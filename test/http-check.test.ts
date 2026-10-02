import { describe, expect, it } from 'vitest';
import { checkHttp, matchesAcceptedCodes, type HttpCheckConfig } from '../worker/checks/http';

const cfg: HttpCheckConfig = {
  url: 'https://example.test/',
  method: 'GET',
  headers: {},
  body: '',
  acceptedCodes: ['200-299'],
  keyword: '',
  invertKeyword: false,
  timeoutS: 5,
  maxRedirects: 10,
};

function fetcher(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    if (init?.signal?.aborted) throw new Error('aborted');
    return route();
  }) as typeof fetch;
}

describe('matchesAcceptedCodes', () => {
  it('supports ranges and single codes', () => {
    expect(matchesAcceptedCodes(204, ['200-299'])).toBe(true);
    expect(matchesAcceptedCodes(301, ['200-299'])).toBe(false);
    expect(matchesAcceptedCodes(301, ['200-299', '301'])).toBe(true);
  });
});

describe('checkHttp', () => {
  it('passes on accepted status', async () => {
    const r = await checkHttp(cfg, fetcher({ 'https://example.test/': () => new Response('ok') }));
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeTypeOf('number');
  });

  it('fails on unexpected status', async () => {
    const r = await checkHttp(cfg, fetcher({ 'https://example.test/': () => new Response('x', { status: 503 }) }));
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/^Status code 503/);
  });

  it('checks keyword and inverted keyword', async () => {
    const f = fetcher({ 'https://example.test/': () => new Response('hello world') });
    expect((await checkHttp({ ...cfg, keyword: 'world' }, f)).ok).toBe(true);
    expect((await checkHttp({ ...cfg, keyword: 'nope' }, f)).ok).toBe(false);
    expect((await checkHttp({ ...cfg, keyword: 'world', invertKeyword: true }, f)).ok).toBe(false);
    expect((await checkHttp({ ...cfg, keyword: 'nope', invertKeyword: true }, f)).ok).toBe(true);
  });

  it('follows redirects up to maxRedirects', async () => {
    const f = fetcher({
      'https://example.test/': () => new Response(null, { status: 302, headers: { location: '/next' } }),
      'https://example.test/next': () => new Response('done'),
    });
    expect((await checkHttp(cfg, f)).ok).toBe(true);
    const noFollow = await checkHttp({ ...cfg, maxRedirects: 0 }, f);
    expect(noFollow.ok).toBe(false);
    expect(noFollow.msg).toMatch(/^Status code 302/);
  });

  it('reports timeout', async () => {
    const slow: typeof fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const r = await checkHttp({ ...cfg, timeoutS: 1 }, slow);
    expect(r).toMatchObject({ ok: false, msg: 'Timeout after 1s' });
  });
});

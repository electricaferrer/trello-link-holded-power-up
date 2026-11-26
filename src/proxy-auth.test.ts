import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createParentJwtSource, getProxyJwt, proxyFetch } from './proxy-auth';

const NOW_MS = Date.UTC(2026, 10, 26, 9, 0, 0);

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeJwt(expSeconds: number, id = 'a'): string {
  return `${base64url(JSON.stringify({ alg: 'RS256' }))}.${base64url(JSON.stringify({ exp: expSeconds, id }))}.sig-${id}`;
}

function jwtSource(...tokens: string[]) {
  const jwt = vi.fn();
  for (const token of tokens) jwt.mockResolvedValueOnce(token);
  return { jwt };
}

describe('getProxyJwt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses the JWT until 60 s before its exp', async () => {
    const exp = NOW_MS / 1000 + 900;
    const source = jwtSource(fakeJwt(exp, 'first'), fakeJwt(exp + 900, 'second'));

    expect(await getProxyJwt(source)).toBe(fakeJwt(exp, 'first'));
    vi.setSystemTime(NOW_MS + 839_000);
    expect(await getProxyJwt(source)).toBe(fakeJwt(exp, 'first'));
    expect(source.jwt).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW_MS + 840_000);
    expect(await getProxyJwt(source)).toBe(fakeJwt(exp + 900, 'second'));
    expect(source.jwt).toHaveBeenCalledTimes(2);
  });

  it('asks for a new JWT when forced', async () => {
    const exp = NOW_MS / 1000 + 900;
    const source = jwtSource(fakeJwt(exp, 'first'), fakeJwt(exp, 'second'));

    await getProxyJwt(source);
    expect(await getProxyJwt(source, { forceRefresh: true })).toBe(fakeJwt(exp, 'second'));
    expect(await getProxyJwt(source)).toBe(fakeJwt(exp, 'second'));
    expect(source.jwt).toHaveBeenCalledTimes(2);
  });

  it('does not keep a JWT whose exp cannot be read', async () => {
    const source = jwtSource('opaque-token', 'opaque-token-2');

    expect(await getProxyJwt(source)).toBe('opaque-token');
    expect(await getProxyJwt(source)).toBe('opaque-token-2');
  });

  it('shares one t.jwt() call between concurrent requests', async () => {
    const source = jwtSource(fakeJwt(NOW_MS / 1000 + 900));

    const [first, second] = await Promise.all([getProxyJwt(source), getProxyJwt(source)]);

    expect(first).toBe(second);
    expect(source.jwt).toHaveBeenCalledTimes(1);
  });

  it('lets a failed t.jwt() be retried', async () => {
    const source = { jwt: vi.fn().mockRejectedValueOnce(new Error('not signed in')).mockResolvedValueOnce('token') };

    await expect(getProxyJwt(source)).rejects.toThrow('not signed in');
    expect(await getProxyJwt(source)).toBe('token');
  });
});

describe('proxyFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the JWT as a bearer token and keeps the request options', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchImpl);
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 900);

    await proxyFetch(jwtSource(token), 'https://proxy.test/v2/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"X"}',
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://proxy.test/v2/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{"name":"X"}',
    });
  });

  it('asks for a new JWT and retries once after a 401', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const source = jwtSource(fakeJwt(exp, 'stale'), fakeJwt(exp, 'fresh'));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"UNAUTHORIZED"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await proxyFetch(source, 'https://proxy.test/contacts/search?q=A', {
      method: 'POST',
      body: '{"a":1}',
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${fakeJwt(exp, 'stale')}`);
    expect(fetchImpl.mock.calls[1][1]).toEqual({
      method: 'POST',
      body: '{"a":1}',
      headers: { Authorization: `Bearer ${fakeJwt(exp, 'fresh')}` },
    });
  });

  it('shares one new JWT between requests rejected with 401 at the same time', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const stale = fakeJwt(exp, 'stale');
    const fresh = fakeJwt(exp, 'fresh');
    const source = jwtSource(stale, fresh, fakeJwt(exp, 'extra'));
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => (
      new Response('{}', { status: init.headers.Authorization === `Bearer ${stale}` ? 401 : 200 })
    ));
    vi.stubGlobal('fetch', fetchImpl);

    const responses = await Promise.all([
      proxyFetch(source, 'https://proxy.test/v2/documents/search'),
      proxyFetch(source, 'https://proxy.test/v2/contacts/contact-1'),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(source.jwt).toHaveBeenCalledTimes(2);
    expect(await getProxyJwt(source)).toBe(fresh);
  });

  it('returns the second 401 without retrying again', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const source = jwtSource(fakeJwt(exp, 'one'), fakeJwt(exp, 'two'), fakeJwt(exp, 'three'));
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await proxyFetch(source, 'https://proxy.test/projects/search');

    expect(response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('createParentJwtSource (embedded create-contact form)', () => {
  const ORIGIN = 'https://trello-link-holded-power-up.pages.dev';

  function fakeFrame() {
    const target = new EventTarget();
    const parent = { postMessage: vi.fn() };
    const frame = Object.assign(target, { parent, location: { origin: ORIGIN } });
    const send = (data: unknown, options: { origin?: string; source?: unknown } = {}) => {
      target.dispatchEvent(Object.assign(new Event('message'), {
        data,
        origin: options.origin ?? ORIGIN,
        source: 'source' in options ? options.source : parent,
      }));
    };
    return { frame: frame as unknown as Window, parent, send };
  }

  it('waits for the JWT that the parent card section posts', async () => {
    const { frame, send } = fakeFrame();
    const source = createParentJwtSource(frame);
    let resolved: string | null = null;
    const pending = source.jwt().then((token) => { resolved = token; });

    await Promise.resolve();
    expect(resolved).toBeNull();
    send({ type: 'ef-proxy-jwt', jwt: 'from-parent' });
    await pending;

    expect(resolved).toBe('from-parent');
  });

  it('returns a JWT the parent already posted', async () => {
    const { frame, parent, send } = fakeFrame();
    const source = createParentJwtSource(frame);

    send({ type: 'ef-proxy-jwt', jwt: 'early' });

    expect(await source.jwt()).toBe('early');
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages from another origin, another window or of another type', async () => {
    const { frame, send } = fakeFrame();
    const source = createParentJwtSource(frame);
    let resolved: string | null = null;
    source.jwt().then((token) => { resolved = token; });

    send({ type: 'ef-proxy-jwt', jwt: 'evil-origin' }, { origin: 'https://example.com' });
    send({ type: 'ef-proxy-jwt', jwt: 'evil-window' }, { source: {} });
    send({ type: 'ef-proxy-jwt', jwt: 'no-window' }, { source: null });
    send({ type: 'holded:contact-form-height', jwt: 'wrong-type' });
    send({ type: 'ef-proxy-jwt', jwt: 42 });
    send(null);
    await Promise.resolve();
    expect(resolved).toBeNull();

    send({ type: 'ef-proxy-jwt', jwt: 'good' });
    await Promise.resolve();
    expect(resolved).toBe('good');
  });

  it('asks the parent for a new JWT once the last one was used', async () => {
    const { frame, parent, send } = fakeFrame();
    const source = createParentJwtSource(frame);
    send({ type: 'ef-proxy-jwt', jwt: 'first' });
    await source.jwt();

    const next = source.jwt();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'ef-proxy-jwt-request' }, ORIGIN);
    send({ type: 'ef-proxy-jwt', jwt: 'second' });

    expect(await next).toBe('second');
  });

  it('rejects every waiting request when the parent reports that Trello gave no JWT', async () => {
    const { frame, parent, send } = fakeFrame();
    const source = createParentJwtSource(frame);
    const first = source.jwt();
    const second = source.jwt();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'ef-proxy-jwt-request' }, ORIGIN);

    send({ type: 'ef-proxy-jwt-error' });

    await expect(first).rejects.toThrow('No se pudo obtener la sesión de Trello');
    await expect(second).rejects.toThrow('No se pudo obtener la sesión de Trello');
    // The waiting list is cleared: a later JWT serves the next request, not the rejected ones.
    const next = source.jwt();
    send({ type: 'ef-proxy-jwt', jwt: 'after-error' });
    expect(await next).toBe('after-error');
  });

  it('ignores bridge errors from another origin or another window', async () => {
    const { frame, send } = fakeFrame();
    const source = createParentJwtSource(frame);
    let settled = '';
    source.jwt().then((token) => { settled = token; }, () => { settled = 'rejected'; });

    send({ type: 'ef-proxy-jwt-error' }, { origin: 'https://example.com' });
    send({ type: 'ef-proxy-jwt-error' }, { source: {} });
    await Promise.resolve();
    expect(settled).toBe('');

    send({ type: 'ef-proxy-jwt', jwt: 'good' });
    await Promise.resolve();
    expect(settled).toBe('good');
  });

  it('gives up waiting for the parent after a bounded timeout', async () => {
    vi.useFakeTimers();
    try {
      const { frame, send } = fakeFrame();
      const source = createParentJwtSource(frame);
      const waiting = source.jwt();
      const outcome = waiting.then(() => 'resolved', (err: Error) => err.message);

      await vi.advanceTimersByTimeAsync(9_999);
      send({ type: 'holded:contact-form-height', height: 10 });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);

      expect(await outcome).toContain('No se pudo obtener la sesión de Trello');
      // A JWT that arrives late serves the next request.
      send({ type: 'ef-proxy-jwt', jwt: 'late' });
      expect(await source.jwt()).toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not call the proxy until the parent sends a JWT', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchImpl);
    const { frame, send } = fakeFrame();
    const source = createParentJwtSource(frame);

    const request = proxyFetch(source, 'https://proxy.test/v2/contacts', { method: 'POST' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).not.toHaveBeenCalled();

    send({ type: 'ef-proxy-jwt', jwt: fakeJwt(Math.floor(Date.now() / 1000) + 900) });
    await request;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

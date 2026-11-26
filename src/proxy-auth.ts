// Every call to the Holded proxy carries the Power-Up's Trello JWT (t.jwt()).
// public/card-back.html keeps an inline copy of this logic (no Vite there).

/** Anything that can hand out a Trello JWT: a Trello iframe context or the embedded-form bridge. */
export interface JwtSource {
  jwt(): Promise<string>;
}

/** A JWT is reused until this long before its `exp`. */
const REFRESH_MARGIN_MS = 60_000;

const cachedTokens = new WeakMap<JwtSource, { token: string; refreshAt: number }>();
const pendingTokens = new WeakMap<JwtSource, Promise<string>>();

/** `exp` of a JWT in milliseconds, or null when the payload cannot be read. */
function jwtExpiresAt(token: string): number | null {
  try {
    const payload = token.split('.')[1] ?? '';
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    return typeof claims?.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function cachedJwt(source: JwtSource): string | null {
  const cached = cachedTokens.get(source);
  return cached && Date.now() < cached.refreshAt ? cached.token : null;
}

/**
 * The cached JWT, or a new one from `source.jwt()`. `forceRefresh` asks for a new
 * one; with `rejectedToken` (after a 401), a JWT another call renewed meanwhile is reused.
 */
export async function getProxyJwt(
  source: JwtSource,
  options: { forceRefresh?: boolean; rejectedToken?: string } = {},
): Promise<string> {
  const { forceRefresh = false, rejectedToken } = options;
  const cached = cachedJwt(source);
  if (!forceRefresh && cached) return cached;

  const pending = pendingTokens.get(source);
  if (pending && (!forceRefresh || rejectedToken)) return pending;
  if (rejectedToken && cached && cached !== rejectedToken) return cached;

  const request = source.jwt().then((token) => {
    const expiresAt = jwtExpiresAt(token);
    if (expiresAt) cachedTokens.set(source, { token, refreshAt: expiresAt - REFRESH_MARGIN_MS });
    else cachedTokens.delete(source);
    return token;
  });
  pendingTokens.set(source, request);
  const clear = () => {
    if (pendingTokens.get(source) === request) pendingTokens.delete(source);
  };
  request.then(clear, clear);
  return request;
}

export type ProxyRequestInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

/** `fetch` to the proxy with the JWT; after a 401 it asks for a new JWT and retries once. */
export async function proxyFetch(source: JwtSource, url: string, init: ProxyRequestInit = {}): Promise<Response> {
  const send = (token: string) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  const token = await getProxyJwt(source);
  const response = await send(token);
  if (response.status !== 401) return response;
  return send(await getProxyJwt(source, { forceRefresh: true, rejectedToken: token }));
}

/**
 * JWT source for the create-contact form embedded in the card section, which has
 * no Trello context: the parent posts `{type: "ef-proxy-jwt", jwt}`. Only messages
 * from the parent window and this same origin count. When the last JWT was already
 * used, it asks the parent for a new one and waits.
 */
export function createParentJwtSource(win: Window = window): JwtSource {
  let latest: string | null = null;
  let handedOut: string | null = null;
  let waiting: Array<(token: string) => void> = [];

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== win.location.origin) return;
    const data = event.data as { type?: unknown; jwt?: unknown } | null;
    if (!data || data.type !== 'ef-proxy-jwt' || typeof data.jwt !== 'string' || !data.jwt) return;
    latest = data.jwt;
    if (waiting.length) {
      const resolvers = waiting;
      waiting = [];
      handedOut = latest;
      for (const resolve of resolvers) resolve(data.jwt);
    }
  });

  return {
    jwt() {
      if (latest && latest !== handedOut) {
        handedOut = latest;
        return Promise.resolve(latest);
      }
      return new Promise<string>((resolve) => {
        waiting.push(resolve);
        win.parent.postMessage({ type: 'ef-proxy-jwt-request' }, win.location.origin);
      });
    },
  };
}

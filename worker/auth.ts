// Access control for the proxy: Trello Power-Up JWTs and signed attachment URLs.
// WebCrypto only, no dependencies.

export const TRELLO_JWT_KEYS_URL = 'https://api.trello.com/1/resource/jwt-public-keys';

/** Public keys are kept per isolate for an hour. */
const KEY_CACHE_TTL_S = 60 * 60;
/** After a signature failure, keys older than this are downloaded again once. */
const KEY_REFRESH_AFTER_S = 5 * 60;

const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const HMAC_SHA256 = { name: 'HMAC', hash: 'SHA-256' } as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TrelloJwtEnv {
  TRELLO_POWERUP_ID?: string;
}

export interface TrelloJwtPayload {
  idPlugin: string;
  idMember?: string;
  idBoard?: string;
  iss: string;
  iat: number;
  exp: number;
  [claim: string]: unknown;
}

// Only imported CryptoKeys are cached, never a pending fetch: a promise for I/O
// started by one request cannot be awaited from another request in workerd.
let keyCache: { keys: CryptoKey[]; fetchedAt: number } | null = null;

/** Forgets the cached Trello public keys (tests). */
export function clearTrelloKeyCache(): void {
  keyCache = null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64urlToBytes(value: string): Uint8Array | null {
  if (!BASE64URL.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJsonObject(segment: string): Record<string, unknown> | null {
  const bytes = base64urlToBytes(segment);
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function pemToSpki(pem: string): Uint8Array | null {
  const match = pem.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/);
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/\s+/g, ''));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function downloadTrelloKeys(fetchImpl: FetchLike): Promise<CryptoKey[]> {
  try {
    const response = await fetchImpl(TRELLO_JWT_KEYS_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'holded-proxy' },
    });
    if (!response.ok) return [];
    const body = await response.json() as { keys?: unknown };
    const pems = Array.isArray(body?.keys) ? body.keys.filter((key): key is string => typeof key === 'string') : [];
    const keys = await Promise.all(pems.map(async (pem) => {
      const spki = pemToSpki(pem);
      if (!spki) return null;
      try {
        return await crypto.subtle.importKey('spki', spki, RS256, false, ['verify']);
      } catch {
        return null;
      }
    }));
    return keys.filter((key): key is CryptoKey => key !== null);
  } catch {
    return [];
  }
}

async function trelloKeys(now: number, fetchImpl: FetchLike, refresh: boolean): Promise<CryptoKey[]> {
  if (keyCache && !refresh && now - keyCache.fetchedAt < KEY_CACHE_TTL_S) return keyCache.keys;
  const keys = await downloadTrelloKeys(fetchImpl);
  if (keys.length) {
    keyCache = { keys, fetchedAt: now };
    return keys;
  }
  // A failed download is not cached; keep using the previous keys if there are any.
  return keyCache?.keys ?? [];
}

async function signedByAny(keys: CryptoKey[], signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  for (const key of keys) {
    if (await crypto.subtle.verify(RS256, key, signature, data)) return true;
  }
  return false;
}

/**
 * Verifies a JWT from the Power-Up's `t.jwt()`: RS256 signed with one of Trello's
 * public keys, issued by `trello`, not expired, and for this Power-Up. Returns the
 * payload, or null for any token that does not verify.
 */
export async function verifyTrelloJwt(
  token: string,
  env: TrelloJwtEnv,
  now: number = nowSeconds(),
  fetchImpl: FetchLike = fetch,
): Promise<TrelloJwtPayload | null> {
  const segments = typeof token === 'string' ? token.split('.') : [];
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  const header = decodeJsonObject(encodedHeader);
  if (!header || header.alg !== 'RS256') return null;

  const payload = decodeJsonObject(encodedPayload);
  if (!payload) return null;
  if (payload.iss !== 'trello') return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  // No clock tolerance: an expired JWT gets a 401 (the frontend renews 60 s before exp).
  if (payload.exp <= now) return null;
  if (!env.TRELLO_POWERUP_ID || payload.idPlugin !== env.TRELLO_POWERUP_ID) return null;

  const signature = base64urlToBytes(encodedSignature);
  if (!signature) return null;
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  if (await signedByAny(await trelloKeys(now, fetchImpl, false), signature, data)) {
    return payload as TrelloJwtPayload;
  }
  // Trello may have rotated its keys: download them again, at most once per 5 minutes.
  if (keyCache && now - keyCache.fetchedAt >= KEY_REFRESH_AFTER_S) {
    if (await signedByAny(await trelloKeys(now, fetchImpl, true), signature, data)) {
      return payload as TrelloJwtPayload;
    }
  }
  return null;
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(request: Request): string | null {
  const match = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

export interface AttachmentSignatureParts {
  type: string;
  documentId: string;
  attachmentId: string;
  exp: number;
}

function attachmentSigningInput(parts: AttachmentSignatureParts): Uint8Array {
  return new TextEncoder().encode(`${parts.type}\n${parts.documentId}\n${parts.attachmentId}\n${parts.exp}`);
}

function attachmentKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), HMAC_SHA256, false, [usage]);
}

/** HMAC-SHA256 (base64url) over type, document, attachment and exp. */
export async function signAttachmentUrl(secret: string, parts: AttachmentSignatureParts): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await attachmentKey(secret, 'sign'), attachmentSigningInput(parts));
  return bytesToBase64url(new Uint8Array(signature));
}

/**
 * Checks an attachment signature. `crypto.subtle.verify` compares in constant
 * time and, unlike `timingSafeEqual`, also exists in Node, where the tests run.
 */
export async function verifyAttachmentSignature(
  secret: string,
  parts: AttachmentSignatureParts,
  signature: string,
): Promise<boolean> {
  const bytes = base64urlToBytes(signature);
  // Only the canonical spelling: no padding, no alternative trailing bits.
  if (!bytes || bytesToBase64url(bytes) !== signature) return false;
  return crypto.subtle.verify('HMAC', await attachmentKey(secret, 'verify'), bytes, attachmentSigningInput(parts));
}

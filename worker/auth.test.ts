import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRELLO_JWT_KEYS_URL,
  clearTrelloKeyCache,
  signAttachmentUrl,
  verifyAttachmentSignature,
  verifyTrelloJwt,
} from './auth';
import {
  TEST_POWERUP_ID,
  base64url,
  createTrelloSigner,
  publicKeysResponse,
  trelloClaims,
  type TrelloTestSigner,
} from './test-support/trello-jwt';

const NOW = 1_790_000_000;
const env = { TRELLO_POWERUP_ID: TEST_POWERUP_ID };

let trello: TrelloTestSigner;
let otherKey: TrelloTestSigner;

beforeAll(async () => {
  trello = await createTrelloSigner();
  otherKey = await createTrelloSigner();
});

beforeEach(() => {
  clearTrelloKeyCache();
});

function keysFetch(...pems: string[]) {
  return vi.fn(async (_input: string) => publicKeysResponse(pems));
}

describe('verifyTrelloJwt', () => {
  it('accepts a token signed with a Trello public key for this Power-Up', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const token = await trello.sign(trelloClaims(NOW));

    const payload = await verifyTrelloJwt(token, env, NOW, fetchImpl);

    expect(payload).toMatchObject({ idPlugin: TEST_POWERUP_ID, iss: 'trello', idMember: 'member-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(TRELLO_JWT_KEYS_URL);
  });

  it('rejects a token signed by another key', async () => {
    const token = await otherKey.sign(trelloClaims(NOW));

    expect(await verifyTrelloJwt(token, env, NOW, keysFetch(trello.publicKeyPem))).toBeNull();
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const [header, , signature] = (await trello.sign(trelloClaims(NOW))).split('.');
    const forged = `${header}.${base64url(JSON.stringify(trelloClaims(NOW, { idMember: 'someone-else' })))}.${signature}`;

    expect(await verifyTrelloJwt(forged, env, NOW, keysFetch(trello.publicKeyPem))).toBeNull();
  });

  it('rejects an issuer other than trello', async () => {
    const token = await trello.sign(trelloClaims(NOW, { iss: 'not-trello' }));

    expect(await verifyTrelloJwt(token, env, NOW, keysFetch(trello.publicKeyPem))).toBeNull();
  });

  it('rejects an expired token beyond the 60 s clock margin', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const expired = await trello.sign(trelloClaims(NOW, { iat: NOW - 1000, exp: NOW - 61 }));
    const withinMargin = await trello.sign(trelloClaims(NOW, { iat: NOW - 1000, exp: NOW - 30 }));

    expect(await verifyTrelloJwt(expired, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(withinMargin, env, NOW, fetchImpl)).not.toBeNull();
  });

  it('rejects a token without a numeric exp or iat', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const noExp = await trello.sign(trelloClaims(NOW, { exp: undefined }));
    const noIat = await trello.sign(trelloClaims(NOW, { iat: undefined }));
    const textExp = await trello.sign(trelloClaims(NOW, { exp: String(NOW + 600) }));

    expect(await verifyTrelloJwt(noExp, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(noIat, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(textExp, env, NOW, fetchImpl)).toBeNull();
  });

  it('rejects a token issued for another Power-Up', async () => {
    const token = await trello.sign(trelloClaims(NOW, { idPlugin: '5e66784c606cb1160a8f5dc0' }));

    expect(await verifyTrelloJwt(token, env, NOW, keysFetch(trello.publicKeyPem))).toBeNull();
  });

  it('rejects every token when the Power-Up id is not configured', async () => {
    const token = await trello.sign(trelloClaims(NOW));

    expect(await verifyTrelloJwt(token, {}, NOW, keysFetch(trello.publicKeyPem))).toBeNull();
  });

  it('rejects alg none and HS256 tokens', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const body = base64url(JSON.stringify(trelloClaims(NOW)));
    const none = `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${body}.`;
    const noneWithSignature = `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${body}.${base64url('x')}`;
    // HS256 "signed" with the public key as the HMAC secret: the classic algorithm-confusion attack.
    const hsHeader = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(trello.publicKeyPem),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const hsSignature = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`${hsHeader}.${body}`));
    const hs256 = `${hsHeader}.${body}.${base64url(new Uint8Array(hsSignature))}`;
    const rs256Relabelled = await trello.sign(trelloClaims(NOW), { alg: 'HS256', typ: 'JWT' });

    expect(await verifyTrelloJwt(none, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(noneWithSignature, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(hs256, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(rs256Relabelled, env, NOW, fetchImpl)).toBeNull();
  });

  it('rejects malformed tokens without fetching keys', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const valid = await trello.sign(trelloClaims(NOW));
    const [header, payload] = valid.split('.');

    for (const token of [
      '',
      'not-a-jwt',
      `${header}.${payload}`,
      `${valid}.extra`,
      `${header}.${payload}.sig+with/base64`,
      `${header}.%%%.${valid.split('.')[2]}`,
      `${base64url('{not json')}.${payload}.${valid.split('.')[2]}`,
      `${header}.${base64url('"just a string"')}.${valid.split('.')[2]}`,
    ]) {
      expect(await verifyTrelloJwt(token, env, NOW, fetchImpl), token).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the public keys for an hour', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const token = await trello.sign(trelloClaims(NOW));
    const later = await trello.sign(trelloClaims(NOW + 3500));

    expect(await verifyTrelloJwt(token, env, NOW, fetchImpl)).not.toBeNull();
    expect(await verifyTrelloJwt(later, env, NOW + 3500, fetchImpl)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const afterAnHour = await trello.sign(trelloClaims(NOW + 3601));
    expect(await verifyTrelloJwt(afterAnHour, env, NOW + 3601, fetchImpl)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refetches keys once after a signature failure with keys older than 5 minutes', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(publicKeysResponse([trello.publicKeyPem]))
      .mockResolvedValueOnce(publicKeysResponse([trello.publicKeyPem, otherKey.publicKeyPem]));
    const first = await trello.sign(trelloClaims(NOW));
    const rotated = await otherKey.sign(trelloClaims(NOW + 301));

    expect(await verifyTrelloJwt(first, env, NOW, fetchImpl)).not.toBeNull();
    expect(await verifyTrelloJwt(rotated, env, NOW + 301, fetchImpl)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not refetch keys younger than 5 minutes on a signature failure', async () => {
    const fetchImpl = keysFetch(trello.publicKeyPem);
    const first = await trello.sign(trelloClaims(NOW));
    const foreign = await otherKey.sign(trelloClaims(NOW + 299));

    expect(await verifyTrelloJwt(first, env, NOW, fetchImpl)).not.toBeNull();
    expect(await verifyTrelloJwt(foreign, env, NOW + 299, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects the token when the key endpoint fails or changes format', async () => {
    const token = await trello.sign(trelloClaims(NOW));

    const down = vi.fn().mockRejectedValue(new Error('network'));
    expect(await verifyTrelloJwt(token, env, NOW, down)).toBeNull();

    const status = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    expect(await verifyTrelloJwt(token, env, NOW, status)).toBeNull();

    const reshaped = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jwks: [{ kty: 'RSA' }] })));
    expect(await verifyTrelloJwt(token, env, NOW, reshaped)).toBeNull();

    const badPem = vi.fn().mockResolvedValue(publicKeysResponse(['-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----']));
    expect(await verifyTrelloJwt(token, env, NOW, badPem)).toBeNull();
  });

  it('does not cache a failed key download', async () => {
    const token = await trello.sign(trelloClaims(NOW));
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(publicKeysResponse([trello.publicKeyPem]));

    expect(await verifyTrelloJwt(token, env, NOW, fetchImpl)).toBeNull();
    expect(await verifyTrelloJwt(token, env, NOW + 1, fetchImpl)).not.toBeNull();
  });
});

describe('attachment URL signatures', () => {
  const SECRET = 'attachment-secret-for-tests';
  const parts = { type: 'waybills', documentId: 'doc-1', attachmentId: 'foto 1.jpg', exp: NOW + 900 };

  it('verifies its own base64url HMAC-SHA256 signature', async () => {
    const sig = await signAttachmentUrl(SECRET, parts);

    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyAttachmentSignature(SECRET, parts, sig)).toBe(true);
  });

  it('signs type, document, attachment and exp separated by newlines', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expected = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`waybills\ndoc-1\nfoto 1.jpg\n${NOW + 900}`),
    );

    expect(await signAttachmentUrl(SECRET, parts)).toBe(base64url(new Uint8Array(expected)));
  });

  it('rejects the signature for any other part, secret or a malformed value', async () => {
    const sig = await signAttachmentUrl(SECRET, parts);

    expect(await verifyAttachmentSignature(SECRET, { ...parts, type: 'invoices' }, sig)).toBe(false);
    expect(await verifyAttachmentSignature(SECRET, { ...parts, documentId: 'doc-2' }, sig)).toBe(false);
    expect(await verifyAttachmentSignature(SECRET, { ...parts, attachmentId: 'foto 2.jpg' }, sig)).toBe(false);
    expect(await verifyAttachmentSignature(SECRET, { ...parts, exp: NOW + 901 }, sig)).toBe(false);
    expect(await verifyAttachmentSignature('another-secret', parts, sig)).toBe(false);
    expect(await verifyAttachmentSignature(SECRET, parts, '')).toBe(false);
    expect(await verifyAttachmentSignature(SECRET, parts, 'not base64!')).toBe(false);
    expect(await verifyAttachmentSignature(SECRET, parts, sig.slice(0, -2))).toBe(false);
  });
});

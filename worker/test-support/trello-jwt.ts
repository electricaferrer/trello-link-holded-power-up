// Test-only helpers: an RSA key pair standing in for Trello's JWT signing key.

export const TEST_POWERUP_ID = '69aa97fea83ff5789f8409f7';

const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface TrelloTestSigner {
  /** SPKI public key in PEM, the format served by Trello's jwt-public-keys endpoint. */
  publicKeyPem: string;
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export async function createTrelloSigner(): Promise<TrelloTestSigner> {
  const pair = await crypto.subtle.generateKey(
    { ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey) as ArrayBuffer);
  const lines = base64(spki).match(/.{1,64}/g) ?? [];
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;

  return {
    publicKeyPem,
    async sign(payload, header = { alg: 'RS256', typ: 'JWT' }) {
      const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
      const signature = await crypto.subtle.sign(RS256, pair.privateKey, new TextEncoder().encode(signingInput));
      return `${signingInput}.${base64url(new Uint8Array(signature))}`;
    },
  };
}

export function trelloClaims(now: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idPlugin: TEST_POWERUP_ID,
    idBoard: 'board-1',
    idMember: 'member-1',
    iat: now - 10,
    exp: now + 890,
    iss: 'trello',
    ...overrides,
  };
}

export function publicKeysResponse(pems: string[]): Response {
  return new Response(JSON.stringify({ keys: pems }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

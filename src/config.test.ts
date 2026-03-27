import { describe, it, expect } from 'vitest';

// Test the URL normalization logic directly (same logic as config.ts)
function normalizeProxyUrl(raw: string): string {
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

describe('proxy URL normalization', () => {
  it('adds https:// when protocol is missing', () => {
    expect(normalizeProxyUrl('holded-proxy.electricaferrer.workers.dev'))
      .toBe('https://holded-proxy.electricaferrer.workers.dev');
  });

  it('keeps https:// when already present', () => {
    expect(normalizeProxyUrl('https://holded-proxy.electricaferrer.workers.dev'))
      .toBe('https://holded-proxy.electricaferrer.workers.dev');
  });

  it('keeps http:// when explicitly set', () => {
    expect(normalizeProxyUrl('http://localhost:8787'))
      .toBe('http://localhost:8787');
  });

  it('defaults to https:// for empty value', () => {
    expect(normalizeProxyUrl('')).toBe('https://');
  });
});

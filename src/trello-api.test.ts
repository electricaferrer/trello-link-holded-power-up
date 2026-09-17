import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeForMemberEmail, getCurrentMemberEmail } from './trello-api';

describe('Trello member API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the current member email through the authorized Trello REST API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      email: 'operator@example.com',
    })));
    vi.stubGlobal('fetch', fetchImpl);
    const t = {
      getRestApi: () => ({
        isAuthorized: () => Promise.resolve(true),
        authorize: vi.fn(),
        getToken: () => Promise.resolve('trello-token'),
      }),
    } as any;

    await expect(getCurrentMemberEmail(t)).resolves.toBe('operator@example.com');
    const requestUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe('/1/members/me');
    expect(requestUrl.searchParams.get('token')).toBe('trello-token');
    expect(requestUrl.searchParams.get('fields')).toBe('email');
  });

  it('requests the account scope when authorizing for the member email', async () => {
    const authorize = vi.fn().mockResolvedValue('new-trello-token');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      email: 'operator@example.com',
    })));
    vi.stubGlobal('fetch', fetchImpl);
    const t = {
      getRestApi: () => ({
        isAuthorized: () => Promise.resolve(false),
        authorize,
        getToken: () => Promise.resolve('trello-token'),
      }),
    } as any;

    await expect(getCurrentMemberEmail(t)).resolves.toBe('operator@example.com');
    expect(authorize).toHaveBeenCalledWith({ expiration: 'never', scope: 'read,write,account' });
  });

  it('reauthorizes an existing member token when email access is missing', async () => {
    const authorize = vi.fn().mockResolvedValue('new-trello-token');
    const clearToken = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      email: 'operator@example.com',
    })));
    vi.stubGlobal('fetch', fetchImpl);
    const t = {
      getRestApi: () => ({
        isAuthorized: () => Promise.resolve(true),
        authorize,
        clearToken,
        getToken: () => Promise.resolve('old-trello-token'),
      }),
    } as any;

    await expect(authorizeForMemberEmail(t)).resolves.toBe('operator@example.com');
    expect(clearToken).toHaveBeenCalledBefore(authorize);
    expect(authorize).toHaveBeenCalledWith({ expiration: 'never', scope: 'read,write,account' });
    const requestUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(requestUrl.searchParams.get('token')).toBe('new-trello-token');
  });
});

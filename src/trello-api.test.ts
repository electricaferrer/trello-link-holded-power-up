import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentMemberEmail } from './trello-api';

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
});

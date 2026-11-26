import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContact, addShippingAddress, searchContacts, searchProjects, getContactDetail } from './holded-api';

const JWT = 'header.payload.signature';
// A Trello iframe context: proxy calls take the JWT from t.jwt().
const trello = { jwt: vi.fn(async () => JWT) };

describe('Holded frontend API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches contacts through the proxy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      total: 1,
      results: [{ id: 'contact-1', name: 'Acme' }],
    })));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await searchContacts(trello, 'Acme');

    expect(result.results).toEqual([{ id: 'contact-1', name: 'Acme' }]);
    expect(fetchImpl.mock.calls[0][0]).toContain('/contacts/search?q=Acme');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${JWT}` });
  });

  it('searches projects through the proxy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      total: 1,
      results: [{ id: 'project-1', name: 'Obra' }],
    })));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await searchProjects(trello, 'Obra');

    expect(result.results).toEqual([{ id: 'project-1', name: 'Obra' }]);
    expect(fetchImpl.mock.calls[0][0]).toContain('/projects/search?q=Obra');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${JWT}` });
  });

  it('fetches full contact detail from the internal contact route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'contact-1',
      name: 'Acme',
      shippingAddresses: [],
    })));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await getContactDetail(trello, 'contact-1');

    expect(result).toMatchObject({ id: 'contact-1', name: 'Acme' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/v2/contacts/contact-1');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${JWT}` });
  });

  it('creates contacts through the internal endpoint with a camelCase payload and idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'contact-1',
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await createContact(trello, {
      name: 'Cliente Uno',
      code: 'B123',
      isperson: 0,
      type: 'lead',
      email: 'cliente@example.com',
      phone: '971123123',
      vatnumber: 'ESB123',
      billAddress: {
        address: 'Calle Uno',
        city: 'Palma',
        postalCode: '07001',
        province: 'Illes Balears',
        country: 'Espana',
        countryCode: 'ES',
      },
      defaults: {
        salesTax: ['s_iva_21'],
        purchasesTax: ['p_iva_21'],
      },
    }, 'idem-create-1');

    expect(result).toEqual({ id: 'contact-1' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/v2/contacts?idempotencyKey=idem-create-1');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${JWT}` });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      name: 'Cliente Uno',
      code: 'B123',
      isperson: 0,
      type: 'lead',
      email: 'cliente@example.com',
      phone: '971123123',
      vatnumber: 'ESB123',
      billAddress: {
        address: 'Calle Uno',
        city: 'Palma',
        postalCode: '07001',
        province: 'Illes Balears',
        country: 'Espana',
        countryCode: 'ES',
      },
      defaults: {
        salesTax: ['s_iva_21'],
        purchasesTax: ['p_iva_21'],
      },
    });
  });

  it('appends a shipping address through the internal endpoint with an idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchImpl);

    await addShippingAddress(trello, 'contact-1', {
      name: 'Obra Norte',
      address: 'Calle Dos',
      city: 'Inca',
      postalCode: '07300',
      province: 'Illes Balears',
    }, 'idem-ship-1');

    expect(fetchImpl.mock.calls[0][0]).toContain('/v2/contacts/contact-1/shipping-addresses?idempotencyKey=idem-ship-1');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${JWT}` });
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      name: 'Obra Norte',
      address: 'Calle Dos',
      city: 'Inca',
      postalCode: '07300',
      province: 'Illes Balears',
      country: 'España',
    });
  });

  it('asks for a new JWT and retries once when the proxy answers 401', async () => {
    const source = {
      jwt: vi.fn().mockResolvedValueOnce('stale.jwt.sig').mockResolvedValueOnce('fresh.jwt.sig'),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"UNAUTHORIZED"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0, results: [] })));
    vi.stubGlobal('fetch', fetchImpl);

    await searchContacts(source, 'Acme');

    expect(source.jwt).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer fresh.jwt.sig' });
  });
});

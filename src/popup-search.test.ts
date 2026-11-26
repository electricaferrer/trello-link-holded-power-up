// @ts-nocheck
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const POPUP_JWT = 'popup.jwt.sig';

function installPopupDom(markup: string) {
  const dom = new JSDOM(markup, { url: 'https://power-up.test/' });
  const trello = {
    jwt: vi.fn(async () => POPUP_JWT),
    popup: vi.fn(),
    closePopup: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    card: vi.fn(),
    getRestApi: () => ({
      isAuthorized: async () => true,
      authorize: async () => undefined,
      getToken: async () => 'trello-token',
    }),
  };

  Object.assign(dom.window, {
    TrelloPowerUp: { iframe: () => trello },
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);

  return { dom, trello };
}

describe('popup search behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not link a contact when its full detail cannot be loaded', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total: 1,
        results: [{ id: 'contact-1', name: 'Cliente Uno' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'DATA_NOT_READY', message: 'Not ready' },
      }), { status: 503 }));
    vi.stubGlobal('fetch', fetchImpl);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('./popups/search-contact');

    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = 'Cliente';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.result-item')).not.toBeNull();
    });
    (dom.window.document.querySelector('.result-item') as HTMLElement).click();

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.selection-error')?.textContent)
        .toContain('Pulsa de nuevo para reintentar');
    });
    expect(trello.set).not.toHaveBeenCalled();
    expect(trello.closePopup).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Contact search and contact detail both carry the Trello JWT.
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${POPUP_JWT}` });
    }

    dom.window.close();
  });

  it('opens contact creation inside the card section instead of a popup', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    trello.set.mockResolvedValue(undefined);

    await import('./popups/search-contact');

    dom.window.document.getElementById('create-contact-btn')!.click();

    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());
    expect(trello.set).toHaveBeenCalledWith('card', 'private', 'holdedCreateContactOpen', true);
    expect(trello.popup).not.toHaveBeenCalled();

    dom.window.close();
  });

  it('forwards the contact click event when opening the address-selection popup', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    trello.card.mockResolvedValue({ id: 'card-1' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total: 1,
        results: [{ id: 'contact-1', name: 'Cliente Uno' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'contact-1',
        name: 'Cliente Uno',
        billAddress: {
          address: 'C/ Major 1',
          city: 'Palma',
          postalCode: '07001',
          province: 'Illes Balears',
          country: 'España',
        },
        shippingAddresses: [{
          name: 'Obra Norte',
          address: 'C/ Nord 2',
          city: 'Palma',
          postalCode: '07002',
          province: 'Illes Balears',
          country: 'España',
        }],
      }))));

    await import('./popups/search-contact');

    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = 'Cliente';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.result-item')).not.toBeNull();
    });
    const clickEvent = new dom.window.MouseEvent('click', { bubbles: true });
    dom.window.document.querySelector('.result-item')!.dispatchEvent(clickEvent);

    await vi.waitFor(() => {
      expect(trello.popup).toHaveBeenCalledWith({
        title: 'Seleccionar dirección',
        url: './select-address.html',
        height: 300,
        mouseEvent: clickEvent,
      });
    });

    dom.window.close();
  });

  it('opens address selection when the contact only has its billing address', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    trello.card.mockResolvedValue({ id: 'card-1' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total: 1,
        results: [{ id: 'contact-1', name: 'Cliente Uno' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'contact-1',
        name: 'Cliente Uno',
        billAddress: {
          address: 'C/ Major 1',
          city: 'Palma',
          postalCode: '07001',
          province: 'Illes Balears',
          country: 'España',
        },
        shippingAddresses: [],
      }))));

    await import('./popups/search-contact');

    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = 'Cliente';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.result-item')).not.toBeNull();
    });
    const clickEvent = new dom.window.MouseEvent('click', { bubbles: true });
    dom.window.document.querySelector('.result-item')!.dispatchEvent(clickEvent);

    await vi.waitFor(() => {
      expect(trello.popup).toHaveBeenCalledWith({
        title: 'Seleccionar dirección',
        url: './select-address.html',
        height: 300,
        mouseEvent: clickEvent,
      });
    });
    expect(trello.closePopup).not.toHaveBeenCalled();
    expect(JSON.parse(dom.window.localStorage.getItem('holdedPendingContact:card-1'))).toEqual({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      billAddress: {
        address: 'C/ Major 1',
        city: 'Palma',
        postalCode: '07001',
        province: 'Illes Balears',
        country: 'España',
      },
      shippingAddresses: [],
    });

    dom.window.close();
  });

  it('opens address selection after creating a contact', async () => {
    const { dom, trello } = installPopupDom(`
      <div id="form">
        <input id="name" />
        <input id="code" />
        <input id="address" />
        <input id="city" />
        <input id="postalCode" />
        <input id="province" />
        <input id="country" />
        <input id="email" />
        <input id="phone" />
        <div id="type-toggle">
          <button type="button" data-value="empresa">Empresa</button>
          <button type="button" data-value="persona">Persona</button>
        </div>
        <button type="button" id="submit-btn">Crear contacto</button>
        <div id="code-duplicate-msg"></div>
        <div id="error-msg"></div>
      </div>
    `);
    trello.card.mockResolvedValue({ id: 'card-1', desc: '' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'contact-1',
    })));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/create-contact');

    const values = {
      name: 'Cliente Uno',
      code: 'B12345678',
      address: 'C/ Major 1',
      city: 'Palma',
      postalCode: '07001',
      province: 'Illes Balears',
      country: 'España',
      email: 'cliente@example.com',
    };
    for (const [id, value] of Object.entries(values)) {
      (dom.window.document.getElementById(id) as HTMLInputElement).value = value;
    }
    dom.window.document.querySelector<HTMLButtonElement>('[data-value="empresa"]')!.click();

    const submit = dom.window.document.getElementById('submit-btn') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    const clickEvent = new dom.window.MouseEvent('click', { bubbles: true });
    submit.dispatchEvent(clickEvent);

    await vi.waitFor(() => {
      expect(trello.popup).toHaveBeenCalledWith({
        title: 'Seleccionar dirección',
        url: './select-address.html',
        height: 300,
        mouseEvent: clickEvent,
      });
    });
    expect(trello.closePopup).not.toHaveBeenCalled();
    const createCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('/v2/contacts?idempotencyKey='));
    expect(createCall[1].headers).toMatchObject({ Authorization: `Bearer ${POPUP_JWT}` });
    expect(JSON.parse(dom.window.localStorage.getItem('holdedPendingContact:card-1'))).toEqual({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      email: 'cliente@example.com',
      billAddress: {
        address: 'C/ Major 1',
        city: 'Palma',
        postalCode: '07001',
        province: 'Illes Balears',
        country: 'España',
      },
      shippingAddresses: [],
    });

    dom.window.close();
  });

  it('hands the created contact to the card section when embedded', async () => {
    const { dom, trello } = installPopupDom(`
      <div id="form">
        <input id="name" />
        <input id="code" />
        <input id="address" />
        <input id="city" />
        <input id="postalCode" />
        <input id="province" />
        <input id="country" />
        <input id="email" />
        <input id="phone" />
        <div id="type-toggle">
          <button type="button" data-value="empresa">Empresa</button>
          <button type="button" data-value="persona">Persona</button>
        </div>
        <button type="button" id="submit-btn">Crear contacto</button>
        <div id="code-duplicate-msg"></div>
        <div id="error-msg"></div>
      </div>
    `);
    dom.reconfigure({ url: 'https://power-up.test/create-contact.html?embedded=1' });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage').mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'contact-1',
    })));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/create-contact');
    // The card section hands its Trello JWT to the embedded form.
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'ef-proxy-jwt', jwt: 'parent.jwt.sig' },
      origin: 'https://power-up.test',
      source: dom.window.parent,
    }));

    const values = {
      name: 'Cliente Uno',
      code: 'B12345678',
      address: 'C/ Major 1',
      city: 'Palma',
      postalCode: '07001',
      province: 'Illes Balears',
      country: 'España',
      email: 'cliente@example.com',
    };
    for (const [id, value] of Object.entries(values)) {
      (dom.window.document.getElementById(id) as HTMLInputElement).value = value;
    }
    dom.window.document.querySelector<HTMLButtonElement>('[data-value="empresa"]')!.click();

    const submit = dom.window.document.getElementById('submit-btn') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    const clickEvent = new dom.window.MouseEvent('click', { bubbles: true });
    submit.dispatchEvent(clickEvent);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'holded:contact-created' }),
      'https://power-up.test',
    ));
    expect(fetchImpl.mock.calls[0][0]).toContain('/v2/contacts?idempotencyKey=');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer parent.jwt.sig' });
    expect(trello.jwt).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'holded:contact-created',
      anchor: { x: expect.any(Number), y: expect.any(Number) },
      pending: {
        contactId: 'contact-1',
        contactName: 'Cliente Uno',
        email: 'cliente@example.com',
        billAddress: {
          address: 'C/ Major 1',
          city: 'Palma',
          postalCode: '07001',
          province: 'Illes Balears',
          country: 'España',
        },
        shippingAddresses: [],
      },
    }, 'https://power-up.test');
    expect(trello.popup).not.toHaveBeenCalled();
    expect(trello.set).not.toHaveBeenCalled();

    dom.window.close();
  });
  it('keeps the embedded submit waiting, without calling the proxy, until the card section sends a JWT', async () => {
    const { dom } = installPopupDom(`
      <div id="form">
        <input id="name" />
        <input id="code" />
        <input id="address" />
        <input id="city" />
        <input id="postalCode" />
        <input id="province" />
        <input id="country" />
        <input id="email" />
        <input id="phone" />
        <div id="type-toggle">
          <button type="button" data-value="empresa">Empresa</button>
          <button type="button" data-value="persona">Persona</button>
        </div>
        <button type="button" id="submit-btn">Crear contacto</button>
        <div id="code-duplicate-msg"></div>
        <div id="error-msg"></div>
      </div>
    `);
    dom.reconfigure({ url: 'https://power-up.test/create-contact.html?embedded=1' });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage').mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'contact-1' })));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/create-contact');

    for (const [id, value] of Object.entries({
      name: 'Cliente Uno',
      code: 'B12345678',
      address: 'C/ Major 1',
      city: 'Palma',
      postalCode: '07001',
      province: 'Illes Balears',
      country: 'España',
      email: 'cliente@example.com',
    })) {
      (dom.window.document.getElementById(id) as HTMLInputElement).value = value;
    }
    dom.window.document.querySelector<HTMLButtonElement>('[data-value="empresa"]')!.click();
    dom.window.document.getElementById('submit-btn')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    // It asks the card section for a JWT and waits.
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'ef-proxy-jwt-request' }, 'https://power-up.test'));
    // A JWT from another origin is ignored.
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'ef-proxy-jwt', jwt: 'foreign.jwt.sig' },
      origin: 'https://example.com',
      source: dom.window.parent,
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchImpl).not.toHaveBeenCalled();

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'ef-proxy-jwt', jwt: 'parent.jwt.sig' },
      origin: 'https://power-up.test',
      source: dom.window.parent,
    }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer parent.jwt.sig' });

    dom.window.close();
  });

  it('lets the embedded form retry, keeping its data, when the card section cannot get a JWT', async () => {
    const { dom } = installPopupDom(`
      <div id="form">
        <input id="name" />
        <input id="code" />
        <input id="address" />
        <input id="city" />
        <input id="postalCode" />
        <input id="province" />
        <input id="country" />
        <input id="email" />
        <input id="phone" />
        <div id="type-toggle">
          <button type="button" data-value="empresa">Empresa</button>
          <button type="button" data-value="persona">Persona</button>
        </div>
        <button type="button" id="submit-btn">Crear contacto</button>
        <div id="code-duplicate-msg"></div>
        <div id="error-msg"></div>
      </div>
    `);
    dom.reconfigure({ url: 'https://power-up.test/create-contact.html?embedded=1' });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage').mockImplementation(() => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'contact-1' })));
    vi.stubGlobal('fetch', fetchImpl);
    const fromParent = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data,
      origin: 'https://power-up.test',
      source: dom.window.parent,
    }));

    await import('./popups/create-contact');
    fromParent({ type: 'ef-proxy-jwt', jwt: 'stale.jwt.sig' });

    const values = {
      name: 'Cliente Uno',
      code: 'B12345678',
      address: 'C/ Major 1',
      city: 'Palma',
      postalCode: '07001',
      province: 'Illes Balears',
      country: 'España',
      email: 'cliente@example.com',
    };
    for (const [id, value] of Object.entries(values)) {
      (dom.window.document.getElementById(id) as HTMLInputElement).value = value;
    }
    dom.window.document.querySelector<HTMLButtonElement>('[data-value="empresa"]')!.click();
    const submit = dom.window.document.getElementById('submit-btn') as HTMLButtonElement;
    submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    // The proxy rejects the JWT; the form asks the card section, whose t.jwt() fails.
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'ef-proxy-jwt-request' }, 'https://power-up.test'));
    expect(submit.textContent).toBe('Creando...');
    fromParent({ type: 'ef-proxy-jwt-error' });

    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    expect(submit.textContent).toBe('Crear contacto');
    const error = dom.window.document.getElementById('error-msg')!;
    expect(error.style.display).toBe('block');
    expect(error.textContent).toContain('No se pudo obtener la sesión de Trello');
    for (const [id, value] of Object.entries(values)) {
      expect((dom.window.document.getElementById(id) as HTMLInputElement).value).toBe(value);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Retrying asks again; with a JWT from the card section the contact is created.
    postMessage.mockClear();
    submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'ef-proxy-jwt-request' }, 'https://power-up.test'));
    fromParent({ type: 'ef-proxy-jwt', jwt: 'fresh.jwt.sig' });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'holded:contact-created' }),
      'https://power-up.test',
    ));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer fresh.jwt.sig' });
    // Same submission, same idempotency key: a retry cannot create the contact twice.
    expect(fetchImpl.mock.calls[1][0]).toBe(fetchImpl.mock.calls[0][0]);

    dom.window.close();
  });

  it('shows both the linked client and project code in project results', async () => {
    const { dom } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      total: 1,
      results: [{
        id: 'project-1',
        name: 'Obra Norte',
        contactName: 'Cliente Uno',
        key: 'AUT3',
      }],
    }))));

    await import('./popups/search-project');

    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = 'Obra';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.result-status')?.textContent)
        .toBe('Cliente Uno · AUT3');
    });

    dom.window.close();
  });

  it('adds the mobile creation links after linking a project to a customer', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    trello.get.mockResolvedValue({
      contactId: 'customer-1',
      contactName: 'Cliente Uno',
    });
    trello.card.mockResolvedValue({ id: 'card-1', desc: 'Nota de montaje.' });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total: 1,
        results: [{ id: 'project-1', name: 'Obra Norte' }],
      })))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/search-project');

    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = 'Obra';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.result-item')).not.toBeNull();
    });
    (dom.window.document.querySelector('.result-item') as HTMLElement).click();

    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][0]).toContain('/projects/search?q=Obra');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${POPUP_JWT}` });
    const description = JSON.parse(fetchImpl.mock.calls[1][1].body).desc;
    expect(description).toContain(
      '/albaran-trabajo/nuevo?projectId=project-1&customerId=customer-1'
    );
    expect(description).toContain(
      '/albaran-trabajo-extra/nuevo?projectId=project-1&customerId=customer-1'
    );
    expect(description).toContain(
      '/pedido/nuevo?projectId=project-1&customerId=customer-1'
    );
    expect(description.startsWith('## Cliente y proyecto\n\n')).toBe(true);
    expect(description.endsWith('Nota de montaje.')).toBe(true);

    dom.window.close();
  });
});

describe('search results render CRM data as text (AC-13)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const HOSTILE_NAME = `Cliente <img src=x onerror="window.__xss = 1"> "Uno" 'Dos'`;

  function expectNoInjectedMarkup(results: Element) {
    expect(results.querySelectorAll('img, svg, script, iframe, b')).toHaveLength(0);
    for (const element of results.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.startsWith('on'), `${element.tagName} ${attribute}`).toBe(false);
      }
    }
  }

  async function search(dom: JSDOM, query: string) {
    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = query;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.result-item')).not.toBeNull();
    });
  }

  it('shows contact names, NIF and email with HTML and quotes as literal text and links the original contact', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    trello.card.mockResolvedValue({ id: 'card-1' });
    const contact = {
      id: `contact-"1"' <b>x</b>`,
      name: HOSTILE_NAME,
      code: `B1<img src=x onerror=alert(1)>"'`,
      email: `a"b'<svg onload=alert(1)>@example.com`,
      phone: `<script>window.__xss = 2</script>`,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, results: [contact] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...contact, billAddress: { address: 'C/ Major 1', city: 'Palma' } })));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/search-contact');
    await search(dom, 'Cliente');

    const results = dom.window.document.getElementById('results')!;
    expectNoInjectedMarkup(results);
    expect(results.querySelectorAll('.result-item')).toHaveLength(1);
    expect(results.querySelector('.result-name')!.textContent).toBe(HOSTILE_NAME);
    expect(results.querySelector('.result-email')!.textContent).toBe(`${contact.code} · ${contact.email}`);
    expect((dom.window as any).__xss).toBeUndefined();

    (results.querySelector('.result-item') as HTMLElement).click();
    await vi.waitFor(() => expect(trello.popup).toHaveBeenCalled());

    // The selection uses the original contact: its exact id and name.
    expect(fetchImpl.mock.calls[1][0]).toMatch(new RegExp(`/v2/contacts/${encodeURIComponent(contact.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    const [, , , stored] = trello.set.mock.calls.find(([, , key]) => key === 'holdedPendingContact');
    const pending = JSON.parse(dom.window.localStorage.getItem(stored.localStorageKey)!);
    expect(pending).toMatchObject({ contactId: contact.id, contactName: HOSTILE_NAME });

    dom.window.close();
  });

  it('shows project names, client and code with HTML and quotes as literal text and links the original project', async () => {
    const { dom, trello } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    trello.get.mockResolvedValue({});
    trello.card.mockResolvedValue({ id: 'card-1', desc: '' });
    const project = {
      id: `project-"1"' <b>x</b>`,
      name: `Obra <img src=x onerror="window.__xss = 1"> "Norte" 'Sur'`,
      contactName: `Cliente <svg onload=alert(1)>"'`,
      key: `<b>AUT3</b>"`,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, results: [project] })))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/search-project');
    await search(dom, 'Obra');

    const results = dom.window.document.getElementById('results')!;
    expectNoInjectedMarkup(results);
    expect(results.querySelectorAll('.result-item')).toHaveLength(1);
    expect(results.querySelector('.result-name')!.textContent).toBe(project.name);
    expect(results.querySelector('.result-status')!.textContent).toBe(`${project.contactName} · ${project.key}`);
    expect((dom.window as any).__xss).toBeUndefined();

    (results.querySelector('.result-item') as HTMLElement).click();
    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());

    // The selection uses the original project: its exact id and name.
    expect(trello.set).toHaveBeenCalledWith('card', 'shared', 'holdedData', expect.objectContaining({
      projectId: project.id,
      projectName: project.name,
    }));

    dom.window.close();
  });

  it('shows a search error message as text', async () => {
    const { dom } = installPopupDom(`
      <input id="search" />
      <div id="results"></div>
    `);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: '<img src=x onerror=alert(1)>',
    }), { status: 502 })));

    await import('./popups/search-project');
    const input = dom.window.document.getElementById('search') as HTMLInputElement;
    input.value = 'Obra';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(dom.window.document.querySelector('.error')).not.toBeNull());

    expectNoInjectedMarkup(dom.window.document.getElementById('results')!);
    expect(dom.window.document.querySelector('.error')!.textContent).toBe('Error: <img src=x onerror=alert(1)>');

    dom.window.close();
  });
});

describe('address selection behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('offers address creation without rendering an empty billing address', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    trello.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      billAddress: {
        address: '',
        city: '',
        postalCode: '',
        province: '',
      },
      shippingAddresses: [],
    });

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('create-addr-btn')).not.toBeNull();
    });
    expect(dom.window.document.querySelector('.address-item')).toBeNull();
    expect(dom.window.document.getElementById('create-addr-btn')?.textContent)
      .toContain('Nueva dirección de envío');

    dom.window.close();
  });

  it('labels a shipping address by street and city when its reference is empty', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    trello.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      billAddress: {
        address: '',
        city: '',
        postalCode: '',
        province: '',
      },
      shippingAddresses: [{
        name: '',
        address: 'C/ Nord 2',
        city: 'Palma',
        postalCode: '07002',
        province: 'Illes Balears',
        country: 'España',
      }],
    });

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.address-item')).not.toBeNull();
    });
    expect(dom.window.document.querySelector('.address-name')?.textContent)
      .toBe('C/ Nord 2, Palma');
    expect(dom.window.document.querySelector('.address-detail')?.textContent)
      .toBe('C/ Nord 2, 07002 Palma, Illes Balears');

    dom.window.close();
  });

  it('labels an unnamed shipping address by city when its address is a maps URL', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    trello.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      billAddress: { address: '', city: '', postalCode: '', province: '' },
      shippingAddresses: [{
        name: '',
        address: 'https://maps.app.goo.gl/uukbAwPsPKZh5bYm7',
        city: 'Muro',
        postalCode: '07440',
        province: 'Illes Balears',
        country: 'España',
      }],
    });

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.address-item')).not.toBeNull();
    });
    expect(dom.window.document.querySelector('.address-name')?.textContent).toBe('Muro');

    dom.window.close();
  });

  it('renders CRM address fields as text instead of HTML', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    const unsafeName = '<img src=x onerror="alert(1)">Obra</img>';
    const unsafeAddress = '<strong>Calle Norte 2</strong>';
    trello.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      billAddress: {
        address: '',
        city: '',
        postalCode: '',
        province: '',
      },
      shippingAddresses: [{
        name: unsafeName,
        address: unsafeAddress,
        city: 'Palma',
        postalCode: '07002',
        province: 'Illes Balears',
        country: 'España',
      }],
    });

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.address-item')).not.toBeNull();
    });
    expect(dom.window.document.querySelector('.address-name img')).toBeNull();
    expect(dom.window.document.querySelector('.address-name')?.textContent).toBe(unsafeName);
    expect(dom.window.document.querySelector('.address-detail strong')).toBeNull();
    expect(dom.window.document.querySelector('.address-detail')?.textContent)
      .toContain(unsafeAddress);

    dom.window.close();
  });

  it('adds the mobile creation links after linking a customer to a project', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    const pending = {
      contactId: 'customer-1',
      contactName: 'Cliente Uno',
      email: 'cliente@example.com',
      phone: '971 123 456',
      billAddress: {
        address: 'C/ Major 1',
        city: 'Palma',
        postalCode: '07001',
        province: 'Illes Balears',
        country: 'España',
      },
      shippingAddresses: [],
    };
    trello.get
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({
        projectId: 'project-1',
        projectName: 'Obra Norte',
      })
      .mockResolvedValueOnce(pending);
    trello.card.mockResolvedValue({ id: 'card-1', desc: 'Nota de montaje.' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.address-item')).not.toBeNull();
    });
    expect(dom.window.document.querySelector('.address-detail')?.textContent)
      .toBe('C/ Major 1, 07001 Palma, Illes Balears');
    (dom.window.document.querySelector('.address-item') as HTMLElement).click();

    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());
    const description = JSON.parse(fetchImpl.mock.calls[0][1].body).desc;
    expect(description).toContain(
      '/albaran-trabajo/nuevo?projectId=project-1&customerId=customer-1'
    );
    expect(description).toContain(
      '**Dirección:** [C/ Major 1, 07001 Palma, Illes Balears, España ↗](https://www.google.com/maps/search/?api=1&query=C%2F%20Major%201%2C%2007001%20Palma%2C%20Illes%20Balears%2C%20Espa%C3%B1a)'
    );
    expect(description).toContain('**Teléfono:** [971 123 456 ↗](tel:971123456)');
    expect(description).toContain('**Email:** [cliente@example.com ↗](mailto:cliente%40example.com)');
    expect(description).toContain('{{ contact: Cliente Uno | C/ Major 1, Palma }}');
    expect(description.startsWith('## Cliente y proyecto\n\n')).toBe(true);
    expect(description.endsWith('Nota de montaje.')).toBe(true);
    const saved = trello.set.mock.calls.find((call) => call[2] === 'holdedData')?.[3];
    expect(saved.addressMapQuery).toBe('C/ Major 1, 07001 Palma, Illes Balears, España');

    dom.window.close();
  });

  it('uses the full shipping address for Maps instead of its short reference', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    const pending = {
      contactId: 'customer-1',
      contactName: 'Cliente Uno',
      billAddress: { address: '', city: '', postalCode: '', province: '' },
      shippingAddresses: [{
        name: 'Obra Norte',
        address: 'Rua Norte 2',
        city: 'Porto',
        postalCode: '4000-001',
        province: 'Porto',
        country: 'Portugal',
      }],
    };
    trello.get
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(pending);
    trello.card.mockResolvedValue({ id: 'card-1', desc: '' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.address-item')).not.toBeNull();
    });
    (dom.window.document.querySelector('.address-item') as HTMLElement).click();

    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());
    const description = JSON.parse(fetchImpl.mock.calls[0][1].body).desc;
    expect(description).toContain(
      'query=Rua%20Norte%202%2C%204000-001%20Porto%2C%20Porto%2C%20Portugal'
    );
    expect(description).toContain('{{ contact: Cliente Uno | Obra Norte }}');
    const saved = trello.set.mock.calls.find((call) => call[2] === 'holdedData')?.[3];
    expect(saved.addressMapQuery).toBe('Rua Norte 2, 4000-001 Porto, Porto, Portugal');

    dom.window.close();
  });

  it('adds the newly created shipping address as a Google Maps link', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    const pending = {
      contactId: 'customer-1',
      contactName: 'Cliente Uno',
      billAddress: { address: '', city: '', postalCode: '', province: '' },
      shippingAddresses: [],
    };
    trello.get
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(pending);
    trello.card.mockResolvedValue({ id: 'card-1', desc: '' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('create-addr-btn')).not.toBeNull();
    });
    dom.window.document.getElementById('create-addr-btn')!.click();

    const values = {
      'addr-name': 'Obra Nueva',
      'addr-address': 'C/ Nou 3',
      'addr-city': 'Palma',
      'addr-postalCode': '07003',
      'addr-province': 'Illes Balears',
    };
    for (const [id, value] of Object.entries(values)) {
      (dom.window.document.getElementById(id) as HTMLInputElement).value = value;
    }
    dom.window.document.getElementById('create-form')!
      .dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    (dom.window.document.getElementById('btn-create') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('/shipping-addresses?idempotencyKey=');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${POPUP_JWT}` });
    const description = JSON.parse(fetchImpl.mock.calls[1][1].body).desc;
    expect(description).toContain(
      'query=C%2F%20Nou%203%2C%2007003%20Palma%2C%20Illes%20Balears%2C%20Espa%C3%B1a'
    );
    expect(description).toContain('{{ contact: Cliente Uno | Obra Nueva }}');
    const saved = trello.set.mock.calls.find((call) => call[2] === 'holdedData')?.[3];
    expect(saved.addressMapQuery).toBe('C/ Nou 3, 07003 Palma, Illes Balears, España');

    dom.window.close();
  });

  it('keeps the exact casing of a maps URL typed as a new address', async () => {
    const { dom, trello } = installPopupDom('<div id="addresses"></div>');
    const pending = {
      contactId: 'customer-1',
      contactName: 'Cliente Uno',
      billAddress: { address: '', city: '', postalCode: '', province: '' },
      shippingAddresses: [],
    };
    trello.get
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(pending);
    trello.card.mockResolvedValue({ id: 'card-1', desc: '' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/select-address');

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('create-addr-btn')).not.toBeNull();
    });
    dom.window.document.getElementById('create-addr-btn')!.click();

    const values = {
      'addr-name': 'Finca Muro',
      'addr-address': ' https://maps.app.goo.gl/uukbawpsphzbybm7 ',
      'addr-city': 'Muro',
      'addr-postalCode': '07440',
      'addr-province': 'Illes Balears',
    };
    for (const [id, value] of Object.entries(values)) {
      (dom.window.document.getElementById(id) as HTMLInputElement).value = value;
    }
    dom.window.document.getElementById('create-form')!
      .dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    (dom.window.document.getElementById('btn-create') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(trello.closePopup).toHaveBeenCalled());
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).address)
      .toBe('https://maps.app.goo.gl/uukbawpsphzbybm7');
    const description = JSON.parse(fetchImpl.mock.calls[1][1].body).desc;
    expect(description).toContain(
      '**Dirección:** [Finca Muro · 07440 Muro, Illes Balears, España ↗](https://maps.app.goo.gl/uukbawpsphzbybm7)'
    );

    dom.window.close();
  });
});

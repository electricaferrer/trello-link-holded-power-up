// @ts-nocheck
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

function installReportPopupDom() {
  const dom = new JSDOM(`
    <div id="loading">Cargando informe…</div>
    <div id="load-error"></div>
    <form id="report-form" hidden>
      <input id="customer-query" />
      <div id="customer-results"></div>
      <input id="project-query" />
      <div id="project-results"></div>
      <select id="estimate"></select>
      <div id="recipient-chips"></div>
      <input id="additional-email" />
      <button id="add-email" type="button"></button>
      <select id="approval-status"></select>
      <select id="extra-status"></select>
      <select id="source-status"></select>
      <select id="invoice-status">
        <option value="not_invoiced">No facturados</option>
        <option value="invoiced">Facturados</option>
        <option value="all">Todos</option>
      </select>
      <input id="doc-number-query" />
      <input id="text-query" />
      <input id="product-query" />
      <input id="tag-query" />
      <input id="warehouse-query" />
      <input id="min-total" />
      <input id="max-total" />
      <button id="submit-report" type="submit"></button>
      <div id="message"></div>
    </form>
  `, { url: 'https://power-up.test/' });
  const restApi = {
    isAuthorized: () => Promise.resolve(true),
    authorize: vi.fn(),
    getToken: () => Promise.resolve('trello-token'),
  };
  const t = {
    get: vi.fn(),
    popup: vi.fn(),
    closePopup: vi.fn(),
    getRestApi: () => restApi,
  };
  Object.assign(dom.window, { TrelloPowerUp: { iframe: () => t } });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  return { dom, t, restApi };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('report popup', () => {
  it('shows loading while prefilled card data is being resolved', async () => {
    const { dom, t } = installReportPopupDom();
    let resolveCard;
    t.get.mockReturnValue(new Promise((resolve) => { resolveCard = resolve; }));
    vi.stubGlobal('fetch', vi.fn());

    await import('./popups/report');

    expect(dom.window.document.getElementById('loading').textContent).toContain('Cargando');
    expect(dom.window.document.getElementById('report-form').hidden).toBe(true);

    resolveCard({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      projectId: 'project-1',
      projectName: 'Obra Norte',
    });
    dom.window.close();
  });

  it('prefills the user email, linked entities and latest estimate, then shows success', async () => {
    const { dom, t } = installReportPopupDom();
    t.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      projectId: 'project-1',
      projectName: 'Obra Norte',
    });
    const fetchImpl = vi.fn((url, init) => {
      if (String(url).includes('/1/members/me')) {
        return Promise.resolve(new Response(JSON.stringify({ email: 'operator@example.com' })));
      }
      if (String(url).includes('/v2/documents/search')) {
        return Promise.resolve(new Response(JSON.stringify({
          results: [{ id: 'estimate-1', documentNumber: 'PRE-1', displayStatus: 'accepted' }],
          hasMore: false,
        })));
      }
      if (String(url).includes('/v2/reports')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          spreadsheetId: 'sheet-1',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
          reportUrl: 'https://drive.google.com/file/d/report-1/view',
          waybillCount: 3,
          estimateId: 'estimate-1',
        })));
      }
      return Promise.resolve(new Response('{}'));
    });
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/report');

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('report-form').hidden).toBe(false);
    });
    expect(dom.window.document.getElementById('customer-query').value).toBe('Cliente Uno');
    expect(dom.window.document.getElementById('project-query').value).toBe('Obra Norte');
    expect(dom.window.document.querySelector('.recipient-chip').textContent).toContain('operator@example.com');
    expect(dom.window.document.getElementById('estimate').value).toBe('estimate-1');
    expect(dom.window.document.getElementById('invoice-status').value).toBe('not_invoiced');

    dom.window.document.getElementById('additional-email').value = 'team@example.com';
    dom.window.document.getElementById('add-email').click();
    expect(dom.window.document.getElementById('recipient-chips').textContent).toContain('team@example.com');
    dom.window.document.getElementById('invoice-status').value = 'all';

    dom.window.document.getElementById('submit-report').click();

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('message').className).toContain('success');
    });
    expect(dom.window.document.getElementById('message').textContent).toContain('Informe económico solicitado correctamente');
    const reportCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('/v2/reports'));
    expect(reportCall).toBeTruthy();
    expect(JSON.parse(reportCall[1].body).email).toEqual(['operator@example.com', 'team@example.com']);
    expect(JSON.parse(reportCall[1].body).filters.invoiceStatus).toBe('all');
    dom.window.close();
  });

  it('turns separated emails into removable recipient chips', async () => {
    const { dom, t } = installReportPopupDom();
    t.get.mockResolvedValue({ contactId: 'contact-1', contactName: 'Cliente Uno' });
    vi.stubGlobal('fetch', vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/1/members/me')) {
        return Promise.resolve(new Response(JSON.stringify({ email: 'operator@example.com' })));
      }
      if (requestUrl.includes('/v2/documents/search')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [], hasMore: false })));
      }
      return Promise.resolve(new Response('{}'));
    }));

    await import('./popups/report');
    await vi.waitFor(() => expect(dom.window.document.getElementById('report-form').hidden).toBe(false));

    const emailInput = dom.window.document.getElementById('additional-email');
    emailInput.value = 'team@example.com; finance@example.com';
    emailInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(emailInput.value).toBe('');
    expect(dom.window.document.getElementById('recipient-chips').textContent)
      .toContain('team@example.com');
    expect(dom.window.document.getElementById('recipient-chips').textContent)
      .toContain('finance@example.com');
    dom.window.document.querySelector('button[data-email="team@example.com"]').click();
    expect(dom.window.document.getElementById('recipient-chips').textContent)
      .not.toContain('team@example.com');
    expect(dom.window.document.getElementById('recipient-chips').textContent)
      .toContain('operator@example.com');
    dom.window.close();
  });

  it('commits a valid email left in the field when submitting', async () => {
    const { dom, t } = installReportPopupDom();
    t.get.mockResolvedValue({ contactId: 'contact-1', contactName: 'Cliente Uno' });
    const fetchImpl = vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/1/members/me')) {
        return Promise.resolve(new Response(JSON.stringify({ email: 'operator@example.com' })));
      }
      if (requestUrl.includes('/v2/documents/search')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [], hasMore: false })));
      }
      if (requestUrl.includes('/v2/reports')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          spreadsheetId: 'sheet-1',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
          reportUrl: 'https://drive.google.com/file/d/report-1/view',
          waybillCount: 0,
          estimateId: '',
        })));
      }
      return Promise.resolve(new Response('{}'));
    });
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/report');
    await vi.waitFor(() => expect(dom.window.document.getElementById('report-form').hidden).toBe(false));

    dom.window.document.getElementById('additional-email').value = 'team@example.com';
    dom.window.document.getElementById('submit-report').click();

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('message').className).toContain('success');
    });
    const reportCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('/v2/reports'));
    expect(JSON.parse(reportCall[1].body).email)
      .toEqual(['operator@example.com', 'team@example.com']);
    dom.window.close();
  });

  it('shows the generator error and keeps the form available', async () => {
    const { dom, t } = installReportPopupDom();
    t.get.mockResolvedValue({ contactId: 'contact-1', contactName: 'Cliente Uno' });
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('/1/members/me')) {
        return Promise.resolve(new Response(JSON.stringify({ email: 'operator@example.com' })));
      }
      if (String(url).includes('/v2/reports')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'El presupuesto no pertenece al cliente' })));
      }
      return Promise.resolve(new Response(JSON.stringify({ results: [] })));
    }));

    await import('./popups/report');
    await vi.waitFor(() => expect(dom.window.document.getElementById('report-form').hidden).toBe(false));
    dom.window.document.getElementById('submit-report').click();

    await vi.waitFor(() => {
      expect(dom.window.document.getElementById('message').className).toContain('error');
    });
    expect(dom.window.document.getElementById('message').textContent)
      .toContain('El presupuesto no pertenece al cliente');
    expect(dom.window.document.getElementById('report-form').hidden).toBe(false);
    dom.window.close();
  });

  it('invalidates the old customer before the debounced search can submit', async () => {
    const { dom, t } = installReportPopupDom();
    t.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      projectId: 'project-1',
      projectName: 'Obra Norte',
    });
    const fetchImpl = vi.fn((url) => {
      if (String(url).includes('/1/members/me')) {
        return Promise.resolve(new Response(JSON.stringify({ email: 'operator@example.com' })));
      }
      if (String(url).includes('/v2/documents/search')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [], hasMore: false })));
      }
      if (String(url).includes('/contacts/search')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [] })));
      }
      if (String(url).includes('/v2/reports')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          spreadsheetId: 'sheet-1',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
          reportUrl: 'https://drive.google.com/file/d/report-1/view',
          waybillCount: 0,
          estimateId: '',
        })));
      }
      return Promise.resolve(new Response('{}'));
    });
    vi.stubGlobal('fetch', fetchImpl);

    await import('./popups/report');
    await vi.waitFor(() => expect(dom.window.document.getElementById('report-form').hidden).toBe(false));

    const customerQuery = dom.window.document.getElementById('customer-query');
    customerQuery.value = 'Cliente Dos';
    customerQuery.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.document.getElementById('submit-report').click();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dom.window.document.getElementById('message').className).toContain('error');
    expect(dom.window.document.getElementById('message').textContent).toContain('Selecciona un cliente');
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/v2/reports'))).toBe(false);
    dom.window.close();
  });

  it('keeps the selected project when a different customer is chosen', async () => {
    const { dom, t } = installReportPopupDom();
    t.get.mockResolvedValue({
      contactId: 'contact-1',
      contactName: 'Cliente Uno',
      projectId: 'project-1',
      projectName: 'Obra Norte',
    });
    vi.stubGlobal('fetch', vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/1/members/me')) {
        return Promise.resolve(new Response(JSON.stringify({ email: 'operator@example.com' })));
      }
      if (requestUrl.includes('/contacts/search')) {
        return Promise.resolve(new Response(JSON.stringify({
          results: [{ id: 'contact-2', name: 'Cliente Dos', email: null }],
        })));
      }
      if (requestUrl.includes('/v2/documents/search')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [], hasMore: false })));
      }
      return Promise.resolve(new Response('{}'));
    }));

    await import('./popups/report');
    await vi.waitFor(() => expect(dom.window.document.getElementById('report-form').hidden).toBe(false));

    const customerQuery = dom.window.document.getElementById('customer-query');
    customerQuery.value = 'Cliente Dos';
    customerQuery.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(dom.window.document.querySelector('.report-search-item')).not.toBeNull());
    dom.window.document.querySelector('.report-search-item').click();

    expect(dom.window.document.getElementById('customer-query').value).toBe('Cliente Dos');
    expect(dom.window.document.getElementById('project-query').value).toBe('Obra Norte');
    dom.window.close();
  });

  it('offers email reauthorization in the form and enables sending after retry', async () => {
    const { dom, t, restApi } = installReportPopupDom();
    t.get.mockResolvedValue({ contactId: 'contact-1', contactName: 'Cliente Uno' });
    let memberCallCount = 0;
    vi.stubGlobal('fetch', vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/1/members/me')) {
        memberCallCount += 1;
        return Promise.resolve(new Response(JSON.stringify(memberCallCount === 1 ? {} : {
          email: 'operator@example.com',
        })));
      }
      if (requestUrl.includes('/v2/documents/search')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [], hasMore: false })));
      }
      return Promise.resolve(new Response('{}'));
    }));

    await import('./popups/report');
    await vi.waitFor(() => expect(dom.window.document.getElementById('report-form').hidden).toBe(false));

    const reauthorize = dom.window.document.getElementById('reauthorize-email');
    expect(reauthorize).not.toBeNull();
    reauthorize.click();

    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('.recipient-chip')?.textContent)
        .toContain('operator@example.com');
    });
    expect(restApi.authorize).toHaveBeenCalledWith({ expiration: 'never', scope: 'read,write,account' });
    expect(dom.window.document.getElementById('reauthorize-email')).toBeNull();
    dom.window.close();
  });
});

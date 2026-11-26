import { searchContacts, getContactDetail } from '../holded-api';
import { TRELLO_APP_KEY } from '../config';
import { formatSpanishTextCase } from '../spanish-text-case';
import { buildPendingContactSelection, savePendingContactSelection } from '../pending-contact';
import type { HoldedContact, TrelloContext } from '../types';

const t = window.TrelloPowerUp.iframe({ appKey: TRELLO_APP_KEY, appName: 'Holded' }) as unknown as TrelloContext;
const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsDiv = document.getElementById('results') as HTMLDivElement;

let debounceTimer: ReturnType<typeof setTimeout>;

function clearSelectionError() {
  resultsDiv.querySelector('.selection-error')?.remove();
}

function showSelectionError(message: string) {
  clearSelectionError();
  resultsDiv.insertAdjacentHTML('afterbegin', `<div class="error selection-error">${message}</div>`);
}

function addCreateButton() {
  resultsDiv.insertAdjacentHTML('beforeend',
    '<button class="create-btn" id="create-contact-btn">+ Crear contacto nuevo</button>');
  document.getElementById('create-contact-btn')!.addEventListener('click', async () => {
    // Popups close on blur, so the card-back section renders the form inline
    // where the card stays usable for copying data into it.
    await t.set('card', 'private', 'holdedCreateContactOpen', true);
    t.closePopup();
  });
}

function renderResults(contacts: HoldedContact[], query: string) {
  if (!query) {
    resultsDiv.innerHTML = '<div class="empty">Busca un contacto por nombre, email o NIF</div>';
    addCreateButton();
    return;
  }

  if (contacts.length === 0) {
    resultsDiv.innerHTML = '<div class="empty">No se encontraron clientes.</div>';
    addCreateButton();
    return;
  }
  // CRM values go in as text (textContent, dataset), never as HTML.
  resultsDiv.replaceChildren(...contacts.map((contact) => {
    const item = createResultItem(contact.name, [contact.code, contact.email].filter(Boolean).join(' · '));
    item.dataset.id = contact.id;
    item.dataset.name = contact.name;
    item.addEventListener('click', (event) => selectContact(contact, event));
    return item;
  }));

  if (contacts.length <= 3) {
    addCreateButton();
  }
}

function createResultItem(name: string, subtitle: string): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'result-item';
  const avatar = document.createElement('div');
  avatar.className = 'result-avatar';
  avatar.textContent = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const info = document.createElement('div');
  info.className = 'result-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'result-name';
  nameEl.textContent = name;
  info.append(nameEl);
  if (subtitle) {
    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'result-email';
    subtitleEl.textContent = subtitle;
    info.append(subtitleEl);
  }
  item.append(avatar, info);
  return item;
}

async function selectContact(summary: HoldedContact, event: MouseEvent) {
  const contactName = formatSpanishTextCase(summary.name);

  // Search returns summaries; the addresses come from the full detail. If that
  // fetch fails, stop: linking without it could drop the contact's address.
  // Show a retryable error and let the user click the contact again.
  clearSelectionError();
  let contact: HoldedContact;
  try {
    contact = await getContactDetail(t, summary.id);
  } catch (err) {
    console.error('Holded: error loading contact detail', err);
    showSelectionError('No se pudo cargar el contacto. Pulsa de nuevo para reintentar.');
    return;
  }

  const pending = buildPendingContactSelection(contact, contactName);
  await savePendingContactSelection(t, pending);
  t.popup({
    title: 'Seleccionar dirección',
    url: './select-address.html',
    height: 300,
    mouseEvent: event,
  });
}

function showSearchError(err: unknown) {
  const error = document.createElement('div');
  error.className = 'error';
  error.textContent = `Error: ${(err as Error).message}`;
  resultsDiv.replaceChildren(error);
}

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    renderResults([], query);
    return;
  }

  resultsDiv.innerHTML = '<div class="loading">Buscando...</div>';
  try {
    const { results } = await searchContacts(t, query);
    renderResults(results, query);
  } catch (err) {
    showSearchError(err);
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doSearch, 300);
});

renderResults([], '');

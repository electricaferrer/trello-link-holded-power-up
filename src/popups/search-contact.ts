import { fetchAllContacts } from '../holded-api';
import { getCardData, setCardData } from '../storage';
import { addTag } from '../description-tags';
import { updateCardDescription } from '../trello-api';
import { fuzzyFilter } from '../search-utils';
import { TRELLO_APP_KEY } from '../config';
import { getCachedContacts, setCachedContacts, getCacheTimestamp } from '../contacts-cache';
import type { HoldedContact, PendingContactSelection, TrelloContext } from '../types';

const t = window.TrelloPowerUp.iframe({ appKey: TRELLO_APP_KEY, appName: 'Holded' }) as unknown as TrelloContext;
const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsDiv = document.getElementById('results') as HTMLDivElement;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const tooltipEl = reloadBtn.querySelector('.tooltip') as HTMLSpanElement;

let debounceTimer: ReturnType<typeof setTimeout>;
let allContacts: HoldedContact[] | null = null;
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

function updateTooltip() {
  if (allContacts) {
    const ts = getCacheTimestamp();
    const ago = ts ? formatTimeAgo(ts) : '';
    tooltipEl.textContent = `${allContacts.length} contactos${ago ? ` (${ago})` : ''} — pulsa para recargar`;
  } else {
    tooltipEl.textContent = 'Cargar lista de contactos desde Holded';
  }
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function stripNonDigits(v: string | null | undefined): string {
  return v ? v.replace(/\D/g, '') : '';
}

function filterContacts(contacts: HoldedContact[], query: string): HoldedContact[] {
  return fuzzyFilter(contacts, query, (c) =>
    [c.name, c.email, c.code, c.tradeName, c.vatnumber, c.phone, c.mobile,
     stripNonDigits(c.phone), stripNonDigits(c.mobile)].filter(Boolean).join(' ')
  );
}

function addCreateButton() {
  resultsDiv.insertAdjacentHTML('beforeend',
    '<button class="create-btn" id="create-contact-btn">+ Crear contacto nuevo</button>');
  document.getElementById('create-contact-btn')!.addEventListener('click', () => {
    t.popup({ title: 'Crear contacto', url: './create-contact.html', height: 420 });
  });
}

function renderResults(contacts: HoldedContact[], query: string) {
  if (!query) {
    if (!allContacts) {
      resultsDiv.innerHTML =
        '<div class="empty">Pulsa ↻ para cargar los contactos desde Holded</div>';
    } else {
      resultsDiv.innerHTML = '<div class="empty">Busca un contacto por nombre, email o NIF</div>';
    }
    addCreateButton();
    return;
  }

  if (!allContacts) {
    resultsDiv.innerHTML =
      '<div class="empty">Primero carga los contactos pulsando ↻</div>';
    return;
  }

  if (contacts.length === 0) {
    resultsDiv.innerHTML = '<div class="empty">No se encontraron clientes.</div>';
    addCreateButton();
    return;
  }
  resultsDiv.innerHTML = contacts
    .map(
      (c) => {
        const initials = c.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
        return `
    <div class="result-item" data-id="${c.id}" data-name="${c.name}">
      <div class="result-avatar">${initials}</div>
      <div class="result-info">
        <div class="result-name">${c.name}</div>
        ${c.code || c.email ? `<div class="result-email">${[c.code, c.email].filter(Boolean).join(' · ')}</div>` : ''}
      </div>
    </div>`;
      }
    )
    .join('');

  if (contacts.length <= 3) {
    addCreateButton();
  }

  resultsDiv.querySelectorAll('.result-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = (el as HTMLElement).dataset.id!;
      const contact = contacts.find((c) => c.id === id)!;

      if (contact.shippingAddresses && contact.shippingAddresses.length > 0) {
        const pending: PendingContactSelection = {
          contactId: contact.id,
          contactName: contact.name,
          billAddress: contact.billAddress,
          shippingAddresses: contact.shippingAddresses,
        };
        await t.set('card', 'shared', 'holdedPendingContact', pending);
        t.popup({ title: 'Seleccionar dirección', url: './select-address.html', height: 300 });
      } else {
        const addressLabel = [contact.billAddress?.address, contact.billAddress?.city]
          .filter(Boolean).join(', ') || undefined;
        const data = await getCardData(t);
        data.contactId = contact.id;
        data.contactName = contact.name;
        data.addressLabel = addressLabel;
        await setCardData(t, data);
        try {
          const card = await t.card('id', 'desc');
          const newDesc = addTag(card.desc || '', 'contact', contact.name, addressLabel);
          await updateCardDescription(t, newDesc);
        } catch (err) { console.error('Holded: error syncing description', err); }
        t.closePopup();
      }
    });
  });
}

function doSearch() {
  const query = searchInput.value.trim();
  if (!allContacts) {
    renderResults([], query);
    return;
  }
  const filtered = query ? filterContacts(allContacts, query) : [];
  renderResults(filtered, query);
}

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doSearch, 300);
});

function showCooldownWarning() {
  const existing = document.getElementById('cooldown-warning');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'cooldown-warning';
  banner.className = 'cooldown-warning';
  banner.innerHTML = `
    <span>La lista se recargó hace poco. Solo es necesario recargar si no encuentras un contacto que debería existir.</span>
    <div class="cooldown-actions">
      <button class="cooldown-dismiss" id="cooldown-dismiss">Entendido</button>
      <button class="cooldown-force" id="cooldown-force">Recargar igualmente</button>
    </div>
  `;
  reloadBtn.parentElement!.after(banner);

  document.getElementById('cooldown-dismiss')!.addEventListener('click', () => banner.remove());
  document.getElementById('cooldown-force')!.addEventListener('click', async () => {
    banner.remove();
    await fetchFromServer();
  });
}

async function fetchFromServer() {
  reloadBtn.classList.add('spinning');
  try {
    const contacts = await fetchAllContacts();
    allContacts = contacts;
    setCachedContacts(contacts);
    updateTooltip();
    doSearch();
  } catch (err) {
    resultsDiv.innerHTML = `<div class="error">Error: ${(err as Error).message}</div>`;
  }
  reloadBtn.classList.remove('spinning');
}

reloadBtn.addEventListener('click', async () => {
  const lastReload = getCacheTimestamp();
  if (lastReload && (Date.now() - lastReload) < RELOAD_COOLDOWN_MS) {
    showCooldownWarning();
    return;
  }
  await fetchFromServer();
});

// Load from cache on startup
allContacts = getCachedContacts();
updateTooltip();
doSearch();

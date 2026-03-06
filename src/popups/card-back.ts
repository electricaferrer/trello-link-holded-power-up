import { getCardData, removeCardData } from '../storage';
import type { TrelloContext } from '../types';

const HOLDED_CONTACT_URL = 'https://app.holded.com/contacts/';
const HOLDED_PROJECT_URL = 'https://app.holded.com/projects/p/';

const t = window.TrelloPowerUp.iframe() as unknown as TrelloContext;
const contentDiv = document.getElementById('content') as HTMLDivElement;

async function render() {
  const data = await getCardData(t);
  const rows: string[] = [];

  if (data.contactName) {
    const link = data.contactId
      ? `<a class="value link" href="${HOLDED_CONTACT_URL}${data.contactId}" target="_blank">${data.contactName}</a>`
      : `<div class="value">${data.contactName}</div>`;
    rows.push(`
      <div class="row">
        <div>
          <div class="label">Cliente</div>
          ${link}
        </div>
        <span class="unlink" data-field="contact">Desvincular</span>
      </div>
    `);
  }

  if (data.projectName) {
    const link = data.projectId
      ? `<a class="value link" href="${HOLDED_PROJECT_URL}${data.projectId}" target="_blank">${data.projectName}</a>`
      : `<div class="value">${data.projectName}</div>`;
    rows.push(`
      <div class="row">
        <div>
          <div class="label">Proyecto</div>
          ${link}
        </div>
        <span class="unlink" data-field="project">Desvincular</span>
      </div>
    `);
  }

  if (rows.length === 0) {
    contentDiv.innerHTML = '<div class="empty">No hay datos vinculados de Holded.</div>';
  } else {
    contentDiv.innerHTML = rows.join('');
  }

  contentDiv.querySelectorAll('.unlink').forEach((el) => {
    el.addEventListener('click', async () => {
      const field = (el as HTMLElement).dataset.field as 'contact' | 'project';
      await removeCardData(t, field);
      render();
    });
  });

  t.sizeTo(contentDiv);
}

render();

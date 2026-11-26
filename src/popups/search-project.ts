import { searchProjects } from '../holded-api';
import { getCardData, setCardData } from '../storage';
import { syncDescriptionSection } from '../description-tags';
import { updateCardDescription } from '../trello-api';
import { TRELLO_APP_KEY } from '../config';
import type { HoldedProject, TrelloContext } from '../types';

const t = window.TrelloPowerUp.iframe({ appKey: TRELLO_APP_KEY, appName: 'Holded' }) as unknown as TrelloContext;
const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsDiv = document.getElementById('results') as HTMLDivElement;

let debounceTimer: ReturnType<typeof setTimeout>;

function renderResults(projects: HoldedProject[], query: string) {
  if (!query) {
    resultsDiv.innerHTML = '<div class="empty">Busca un proyecto por nombre</div>';
    return;
  }

  if (projects.length === 0) {
    resultsDiv.innerHTML = '<div class="empty">No se encontraron proyectos.</div>' +
      '<button class="create-btn" id="create-project-btn">+ Crear proyecto en Holded</button>';
    document.getElementById('create-project-btn')!.addEventListener('click', () => {
      window.open('https://app.holded.com/projects/view', '_blank');
    });
    return;
  }
  // CRM values go in as text (textContent, dataset), never as HTML.
  resultsDiv.replaceChildren(...projects.map((project) => {
    const item = createResultItem(project.name, [project.contactName, project.key].filter(Boolean).join(' · '));
    item.dataset.id = project.id;
    item.dataset.name = project.name;
    item.addEventListener('click', () => selectProject(project));
    return item;
  }));

  if (projects.length <= 3) {
    resultsDiv.insertAdjacentHTML('beforeend',
      '<button class="create-btn" id="create-project-btn">+ Crear proyecto en Holded</button>');
    document.getElementById('create-project-btn')!.addEventListener('click', () => {
      window.open('https://app.holded.com/projects/view', '_blank');
    });
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
    subtitleEl.className = 'result-status';
    subtitleEl.textContent = subtitle;
    info.append(subtitleEl);
  }
  item.append(avatar, info);
  return item;
}

async function selectProject(project: HoldedProject) {
  const data = await getCardData(t);
  data.projectId = project.id;
  data.projectName = project.name;
  await setCardData(t, data);
  try {
    const card = await t.card('id', 'desc');
    const newDesc = syncDescriptionSection(card.desc || '', data);
    await updateCardDescription(t, newDesc);
  } catch (err) { console.error('Holded: error syncing description', err); }
  t.closePopup();
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
    const { results } = await searchProjects(t, query);
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

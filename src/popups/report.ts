import { getCardData } from '../storage';
import {
  buildReportRecipients,
  createReportRequest,
  DEFAULT_REPORT_FILTERS,
  generateReport,
  searchReportEstimates,
  type ReportApprovalStatus,
  type ReportEstimate,
  type ReportExtraStatus,
  type ReportInvoiceStatus,
  type ReportSourceStatus,
} from '../report-api';
import { authorizeForMemberEmail, getCurrentMemberEmail } from '../trello-api';
import { searchContacts, searchProjects } from '../holded-api';
import { TRELLO_APP_KEY } from '../config';
import type { CardHoldedData, HoldedContact, HoldedProject, TrelloContext } from '../types';

const t = window.TrelloPowerUp.iframe({ appKey: TRELLO_APP_KEY, appName: 'Holded' }) as TrelloContext;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const loadErrorEl = document.getElementById('load-error') as HTMLDivElement;
const formEl = document.getElementById('report-form') as HTMLFormElement;
const messageEl = document.getElementById('message') as HTMLDivElement;
const customerQueryEl = document.getElementById('customer-query') as HTMLInputElement;
const customerResultsEl = document.getElementById('customer-results') as HTMLDivElement;
const projectQueryEl = document.getElementById('project-query') as HTMLInputElement;
const projectResultsEl = document.getElementById('project-results') as HTMLDivElement;
const estimateEl = document.getElementById('estimate') as HTMLSelectElement;
const invoiceStatusEl = document.getElementById('invoice-status') as HTMLSelectElement;
const recipientChipsEl = document.getElementById('recipient-chips') as HTMLDivElement;
const additionalEmailEl = document.getElementById('additional-email') as HTMLInputElement;
const addEmailEl = document.getElementById('add-email') as HTMLButtonElement;
const submitEl = document.getElementById('submit-report') as HTMLButtonElement;

const approvalStatusEl = document.getElementById('approval-status') as HTMLSelectElement;
const extraStatusEl = document.getElementById('extra-status') as HTMLSelectElement;
const sourceStatusEl = document.getElementById('source-status') as HTMLSelectElement;
const filterInputs = {
  docNumberQuery: document.getElementById('doc-number-query') as HTMLInputElement,
  textQuery: document.getElementById('text-query') as HTMLInputElement,
  productQuery: document.getElementById('product-query') as HTMLInputElement,
  tagQuery: document.getElementById('tag-query') as HTMLInputElement,
  warehouseQuery: document.getElementById('warehouse-query') as HTMLInputElement,
  minTotal: document.getElementById('min-total') as HTMLInputElement,
  maxTotal: document.getElementById('max-total') as HTMLInputElement,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cardData: CardHoldedData = {};
let operatorEmail = '';
let selectedCustomer: { id: string; name: string } | null = null;
let selectedProject: { id: string; name: string } | null = null;
let additionalEmails: string[] = [];
let estimates: ReportEstimate[] = [];
let customerSearchTimer: ReturnType<typeof setTimeout> | undefined;
let projectSearchTimer: ReturnType<typeof setTimeout> | undefined;
let estimateLoadGeneration = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] as string);
}

function showMessage(message: string, kind: 'error' | 'success' | 'warning') {
  messageEl.className = `message ${kind}`;
  messageEl.innerHTML = message;
  messageEl.hidden = false;
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.textContent = '';
}

function showEmailRecovery(message: string, kind: 'error' | 'warning') {
  showMessage(
    `<span>${escapeHtml(message)}</span><button type="button" class="reauthorize-email" id="reauthorize-email">Conceder acceso a Trello</button>`,
    kind,
  );
  document.getElementById('reauthorize-email')?.addEventListener('click', () => {
    const button = document.getElementById('reauthorize-email') as HTMLButtonElement;
    void retryMemberEmail(button);
  }, { once: true });
}

async function retryMemberEmail(button: HTMLButtonElement) {
  button.disabled = true;
  button.textContent = 'Solicitando acceso…';
  try {
    const email = await authorizeForMemberEmail(t);
    if (!email) throw new Error('Trello no ha devuelto un email para este usuario.');
    operatorEmail = email;
    renderRecipients();
    clearMessage();
  } catch (err) {
    showEmailRecovery((err as Error).message || 'No se pudo obtener tu email de Trello.', 'error');
  }
}

function renderRecipients() {
  const recipients = buildReportRecipients(operatorEmail, additionalEmails);
  recipientChipsEl.innerHTML = recipients.map((email) => {
    const isOperator = email === operatorEmail;
    return `<span class="recipient-chip${isOperator ? ' recipient-chip--fixed' : ''}">
      <span>${escapeHtml(email)}</span>
      ${isOperator ? '<span class="recipient-chip-note">Tu email</span>' : `<button type="button" class="recipient-remove" data-email="${escapeHtml(email)}" aria-label="Quitar ${escapeHtml(email)}">×</button>`}
    </span>`;
  }).join('');

  recipientChipsEl.querySelectorAll<HTMLButtonElement>('.recipient-remove').forEach((button) => {
    button.addEventListener('click', () => {
      const email = button.dataset.email;
      additionalEmails = additionalEmails.filter((item) => item !== email);
      renderRecipients();
    });
  });
}

function renderEstimateOptions() {
  estimateEl.innerHTML = '<option value="">Sin presupuesto</option>' + estimates.map((estimate) => {
    const number = estimate.documentNumber || `PRE ${estimate.id.slice(-6)}`;
    const status = estimate.displayStatus ? ` · ${estimate.displayStatus}` : '';
    return `<option value="${escapeHtml(estimate.id)}">${escapeHtml(number + status)}</option>`;
  }).join('');
  estimateEl.value = estimates[0]?.id || '';
}

async function loadEstimates() {
  const generation = ++estimateLoadGeneration;
  estimates = [];
  estimateEl.innerHTML = '<option value="">Cargando presupuestos…</option>';
  estimateEl.disabled = true;
  if (!selectedCustomer) {
    estimateEl.innerHTML = '<option value="">Selecciona un cliente</option>';
    return;
  }

  try {
    const result = await searchReportEstimates(selectedCustomer.id, selectedProject?.id);
    if (generation !== estimateLoadGeneration) return;
    estimates = result.results || [];
    renderEstimateOptions();
  } catch (err) {
    if (generation !== estimateLoadGeneration) return;
    estimateEl.innerHTML = '<option value="">No se pudieron cargar</option>';
    showMessage(`No se pudieron cargar los presupuestos: ${escapeHtml((err as Error).message)}`, 'warning');
  } finally {
    if (generation === estimateLoadGeneration) estimateEl.disabled = false;
  }
}

function selectCustomer(contact: HoldedContact) {
  selectedCustomer = { id: contact.id, name: contact.name };
  customerQueryEl.value = contact.name;
  customerResultsEl.innerHTML = '';
  void loadEstimates();
}

function invalidateCustomerSelection() {
  selectedCustomer = null;
  estimates = [];
  estimateLoadGeneration += 1;
  estimateEl.innerHTML = '<option value="">Selecciona un cliente</option>';
  estimateEl.disabled = false;
}

function renderCustomerResults(contacts: HoldedContact[]) {
  customerResultsEl.innerHTML = contacts.map((contact) =>
    `<button type="button" class="report-search-item" data-id="${escapeHtml(contact.id)}">
      <strong>${escapeHtml(contact.name)}</strong>
      ${contact.email ? `<small>${escapeHtml(contact.email)}</small>` : ''}
    </button>`
  ).join('');
  customerResultsEl.querySelectorAll<HTMLButtonElement>('.report-search-item').forEach((button) => {
    button.addEventListener('click', () => {
      const contact = contacts.find((item) => item.id === button.dataset.id);
      if (contact) selectCustomer(contact);
    });
  });
}

async function doCustomerSearch() {
  const query = customerQueryEl.value.trim();
  if (!query || query === selectedCustomer?.name) {
    customerResultsEl.innerHTML = '';
    return;
  }
  try {
    const result = await searchContacts(query);
    renderCustomerResults(result.results);
  } catch (err) {
    showMessage(`No se pudieron buscar clientes: ${escapeHtml((err as Error).message)}`, 'error');
  }
}

function selectProject(project: HoldedProject) {
  selectedProject = { id: project.id, name: project.name };
  projectQueryEl.value = project.name;
  projectResultsEl.innerHTML = '';
  void loadEstimates();
}

function renderProjectResults(projects: HoldedProject[]) {
  projectResultsEl.innerHTML = projects.map((project) =>
    `<button type="button" class="report-search-item" data-id="${escapeHtml(project.id)}">
      <strong>${escapeHtml(project.name)}</strong>
      ${project.key ? `<small>${escapeHtml(project.key)}</small>` : ''}
    </button>`
  ).join('');
  projectResultsEl.querySelectorAll<HTMLButtonElement>('.report-search-item').forEach((button) => {
    button.addEventListener('click', () => {
      const project = projects.find((item) => item.id === button.dataset.id);
      if (project) selectProject(project);
    });
  });
}

async function doProjectSearch() {
  const query = projectQueryEl.value.trim();
  if (!query || query === selectedProject?.name) {
    projectResultsEl.innerHTML = '';
    if (!query && selectedProject) {
      selectedProject = null;
      void loadEstimates();
    }
    return;
  }
  selectedProject = null;
  try {
    const result = await searchProjects(query);
    renderProjectResults(result.results);
  } catch (err) {
    showMessage(`No se pudieron buscar proyectos: ${escapeHtml((err as Error).message)}`, 'error');
  }
}

function addAdditionalEmails(): boolean {
  const values = additionalEmailEl.value
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.some((email) => !EMAIL_PATTERN.test(email))) {
    showMessage('Escribe emails válidos separados por comas o punto y coma.', 'error');
    return false;
  }
  additionalEmails = [...new Set([...additionalEmails, ...values])]
    .filter((email) => email !== operatorEmail);
  additionalEmailEl.value = '';
  clearMessage();
  renderRecipients();
  return true;
}

function readFilters() {
  return {
    invoiceStatus: invoiceStatusEl.value as ReportInvoiceStatus,
    approvalStatus: approvalStatusEl.value as ReportApprovalStatus,
    extraStatus: extraStatusEl.value as ReportExtraStatus,
    sourceStatus: sourceStatusEl.value as ReportSourceStatus,
    docNumberQuery: filterInputs.docNumberQuery.value.trim(),
    textQuery: filterInputs.textQuery.value.trim(),
    productQuery: filterInputs.productQuery.value.trim(),
    tagQuery: filterInputs.tagQuery.value.trim(),
    warehouseQuery: filterInputs.warehouseQuery.value.trim(),
    minTotal: filterInputs.minTotal.value.trim(),
    maxTotal: filterInputs.maxTotal.value.trim(),
  };
}

function renderSuccess(result: Awaited<ReturnType<typeof generateReport>>) {
  showMessage(
    '<strong>Informe económico solicitado correctamente.</strong>' +
    `<span>${result.waybillCount} albarán${result.waybillCount === 1 ? '' : 'es'} incluido${result.waybillCount === 1 ? '' : 's'}.</span>` +
    `<a href="${escapeHtml(result.reportUrl)}" target="_blank" rel="noopener">Abrir informe PDF ↗</a>` +
    `<a href="${escapeHtml(result.spreadsheetUrl)}" target="_blank" rel="noopener">Abrir hoja de cálculo ↗</a>`,
    'success',
  );
}

async function submitReport(event: SubmitEvent) {
  event.preventDefault();
  clearMessage();
  if (!selectedCustomer) {
    showMessage('Selecciona un cliente para generar el informe.', 'error');
    return;
  }
  if (!operatorEmail) {
    showEmailRecovery('No se pudo obtener tu email de Trello. No se puede solicitar el informe hasta que esté disponible.', 'error');
    return;
  }
  if (additionalEmailEl.value.trim() && !addAdditionalEmails()) return;

  submitEl.disabled = true;
  submitEl.textContent = '€ Solicitando informe económico…';
  try {
    const request = createReportRequest({
      requestId: `informe-${Date.now()}-${crypto.randomUUID()}`,
      customerId: selectedCustomer.id,
      projectId: selectedProject?.id,
      estimateId: estimateEl.value || undefined,
      operatorEmail,
      additionalEmails,
      filters: readFilters(),
    });
    const result = await generateReport(request);
    renderSuccess(result);
  } catch (err) {
    showMessage(escapeHtml((err as Error).message || 'No se pudo generar el informe.'), 'error');
  } finally {
    submitEl.disabled = false;
    submitEl.textContent = '€ Solicitar informe económico';
  }
}

function fillForm(data: CardHoldedData) {
  selectedCustomer = data.contactId
    ? { id: data.contactId, name: data.contactName || data.contactId }
    : null;
  selectedProject = data.projectId
    ? { id: data.projectId, name: data.projectName || data.projectId }
    : null;
  customerQueryEl.value = selectedCustomer?.name || '';
  projectQueryEl.value = selectedProject?.name || '';
  invoiceStatusEl.value = DEFAULT_REPORT_FILTERS.invoiceStatus;
  approvalStatusEl.value = DEFAULT_REPORT_FILTERS.approvalStatus;
  extraStatusEl.value = DEFAULT_REPORT_FILTERS.extraStatus;
  sourceStatusEl.value = DEFAULT_REPORT_FILTERS.sourceStatus;
  renderRecipients();
}

async function initialize() {
  try {
    const [data, email] = await Promise.all([
      getCardData(t),
      getCurrentMemberEmail(t).catch((err) => {
        console.warn('Holded: no se pudo obtener el email de Trello', err);
        return null;
      }),
    ]);
    cardData = data;
    operatorEmail = email || '';
    fillForm(cardData);
    if (!operatorEmail) {
      showEmailRecovery('No se pudo precargar tu email de Trello. La solicitud quedará bloqueada hasta poder obtenerlo.', 'warning');
    }
    await loadEstimates();
    loadingEl.hidden = true;
    formEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    loadErrorEl.textContent = `No se pudo preparar el formulario: ${(err as Error).message}`;
    loadErrorEl.hidden = false;
  }
}

customerQueryEl.addEventListener('input', () => {
  if (customerQueryEl.value.trim() !== selectedCustomer?.name) invalidateCustomerSelection();
  window.clearTimeout(customerSearchTimer);
  customerSearchTimer = window.setTimeout(() => { void doCustomerSearch(); }, 300);
});
projectQueryEl.addEventListener('input', () => {
  window.clearTimeout(projectSearchTimer);
  projectSearchTimer = window.setTimeout(() => { void doProjectSearch(); }, 300);
});
addEmailEl.addEventListener('click', addAdditionalEmails);
additionalEmailEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === 'Tab' || event.key === ',' || event.key === ';') {
    const committed = addAdditionalEmails();
    if (event.key !== 'Tab' || !committed) event.preventDefault();
  }
});
additionalEmailEl.addEventListener('input', () => {
  if (/[,;\s]/.test(additionalEmailEl.value)) addAdditionalEmails();
});
additionalEmailEl.addEventListener('blur', () => {
  if (additionalEmailEl.value.trim()) {
    const committed = addAdditionalEmails();
    if (!committed) additionalEmailEl.focus();
  }
});
formEl.addEventListener('submit', (event) => { void submitReport(event); });

void initialize();

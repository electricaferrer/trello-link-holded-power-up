import { HOLDED_PROXY_URL } from './config';

export type ReportApprovalStatus = 'all' | 'approved' | 'not_approved';
export type ReportExtraStatus = 'all' | 'extra' | 'not_extra';
export type ReportSourceStatus = 'all' | 'with_salesorder' | 'without_salesorder';
export type ReportInvoiceStatus = 'not_invoiced' | 'invoiced' | 'all';

export interface ReportFilters {
  invoiceStatus: ReportInvoiceStatus;
  approvalStatus: ReportApprovalStatus;
  extraStatus: ReportExtraStatus;
  sourceStatus: ReportSourceStatus;
  docNumberQuery: string;
  textQuery: string;
  productQuery: string;
  tagQuery: string;
  warehouseQuery: string;
  minTotal: string;
  maxTotal: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  invoiceStatus: 'not_invoiced',
  approvalStatus: 'all',
  extraStatus: 'all',
  sourceStatus: 'all',
  docNumberQuery: '',
  textQuery: '',
  productQuery: '',
  tagQuery: '',
  warehouseQuery: '',
  minTotal: '',
  maxTotal: '',
};

export interface ReportRequest {
  requestId?: string;
  customerId: string;
  projectId?: string;
  estimateId?: string;
  email: string[];
  filters: ReportFilters;
}

export interface ReportRequestInput {
  requestId?: string;
  customerId: string;
  projectId?: string;
  estimateId?: string;
  operatorEmail: string;
  additionalEmails: string[];
  filters?: Partial<ReportFilters>;
}

export interface ReportEstimate {
  id: string;
  documentNumber: string | null;
  issueDate?: string | null;
  displayStatus?: string | null;
  total?: string | null;
  currency?: string | null;
}

export interface ReportEstimateSearchResult {
  results: ReportEstimate[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface ReportAcceptedResponse {
  ok: true;
  requestId: string;
  status: 'queued';
  acceptedAt: string;
}

export interface ReportRejectedResponse {
  ok: false;
  error: string;
}

function buildRecipients(operatorEmail: string, additionalEmails: string[]): string[] {
  return [...new Set([operatorEmail, ...additionalEmails]
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];
}

export function buildReportRecipients(operatorEmail: string, additionalEmails: string[]): string[] {
  return buildRecipients(operatorEmail, additionalEmails);
}

export function createReportRequest(input: ReportRequestInput): ReportRequest {
  const request: ReportRequest = {
    customerId: input.customerId,
    email: buildRecipients(input.operatorEmail, input.additionalEmails),
    filters: {
      ...DEFAULT_REPORT_FILTERS,
      ...input.filters,
      invoiceStatus: input.filters?.invoiceStatus ?? DEFAULT_REPORT_FILTERS.invoiceStatus,
    },
  };
  if (input.requestId) request.requestId = input.requestId;
  if (input.projectId) request.projectId = input.projectId;
  if (input.estimateId) request.estimateId = input.estimateId;
  return request;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    throw new Error('Respuesta inesperada del servidor.');
  }
  if (!response.ok) {
    const message = parsed && typeof parsed === 'object' && 'error' in parsed
      ? String((parsed as { error: unknown }).error)
      : `Error del servidor (${response.status}).`;
    throw new Error(message);
  }
  return parsed as T;
}

export function searchReportEstimates(
  customerId: string,
  projectId?: string,
): Promise<ReportEstimateSearchResult> {
  const params = new URLSearchParams({
    contactId: customerId,
    type: 'estimates',
    scope: projectId ? 'matched' : 'all',
  });
  if (projectId) params.set('projectId', projectId);
  return fetchJson<ReportEstimateSearchResult>(
    `${HOLDED_PROXY_URL}/v2/documents/search?${params.toString()}`,
  );
}

export async function generateReport(request: ReportRequest): Promise<ReportAcceptedResponse> {
  const result = await fetchJson<ReportAcceptedResponse | ReportRejectedResponse>(
    `${HOLDED_PROXY_URL}/v2/reports`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
  if (!result.ok) throw new Error(result.error || 'No se pudo generar el informe.');
  return result;
}

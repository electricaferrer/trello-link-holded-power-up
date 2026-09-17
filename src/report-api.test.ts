import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REPORT_FILTERS,
  buildReportRecipients,
  createReportRequest,
  generateReport,
  searchReportEstimates,
} from './report-api';

describe('report API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the executing user as the first recipient and deduplicates manual emails', () => {
    expect(buildReportRecipients('Operator@Example.com', [
      'team@example.com',
      ' operator@example.com ',
      '',
      'team@example.com',
    ])).toEqual(['operator@example.com', 'team@example.com']);
  });

  it('builds the report request with the selected invoice filter', () => {
    expect(createReportRequest({
      requestId: 'report-1',
      customerId: 'contact-1',
      projectId: 'project-1',
      estimateId: 'estimate-1',
      operatorEmail: 'operator@example.com',
      additionalEmails: ['team@example.com'],
      filters: { invoiceStatus: 'all', approvalStatus: 'approved' },
    })).toEqual({
      requestId: 'report-1',
      customerId: 'contact-1',
      projectId: 'project-1',
      estimateId: 'estimate-1',
      email: ['operator@example.com', 'team@example.com'],
      filters: {
        ...DEFAULT_REPORT_FILTERS,
        invoiceStatus: 'all',
        approvalStatus: 'approved',
      },
    });
  });

  it('loads the latest estimates for the selected customer and project', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      type: 'estimates',
      results: [{ id: 'estimate-1', documentNumber: 'PRE-1' }],
      hasMore: false,
      nextCursor: null,
    })));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await searchReportEstimates('contact-1', 'project-1');

    expect(result.results).toEqual([{ id: 'estimate-1', documentNumber: 'PRE-1' }]);
    expect(fetchImpl.mock.calls[0][0]).toContain(
      '/v2/documents/search?contactId=contact-1&type=estimates&scope=matched&projectId=project-1',
    );
  });

  it('requests report generation through the Worker without exposing a webhook token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      requestId: 'report-1',
      status: 'queued',
      acceptedAt: '2026-09-17T10:30:00.000Z',
    })));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await generateReport(createReportRequest({
      requestId: 'report-1',
      customerId: 'contact-1',
      operatorEmail: 'operator@example.com',
      additionalEmails: [],
    }));

    expect(result).toEqual({
      ok: true,
      requestId: 'report-1',
      status: 'queued',
      acceptedAt: '2026-09-17T10:30:00.000Z',
    });
    expect(fetchImpl.mock.calls[0][0]).toContain('/v2/reports');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      requestId: 'report-1',
      customerId: 'contact-1',
      email: ['operator@example.com'],
      filters: DEFAULT_REPORT_FILTERS,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).not.toHaveProperty('token');
  });
});

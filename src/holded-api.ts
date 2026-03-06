import type { HoldedContact, HoldedProject } from './types';

const PROXY_BASE = 'https://holded-proxy.mferrer.workers.dev';

async function fetchHolded<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    let msg = `Holded API error: ${response.status}`;
    try { msg = JSON.parse(body).error || msg; } catch {}
    throw new Error(msg);
  }
  return response.json();
}

export async function searchContacts(query: string): Promise<HoldedContact[]> {
  const contacts = await fetchHolded<HoldedContact[]>(`${PROXY_BASE}/api/invoicing/v1/contacts`);
  if (!query) return contacts;
  const q = query.toLowerCase();
  return contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.code && c.code.toLowerCase().includes(q)) ||
      (c.tradeName && c.tradeName.toLowerCase().includes(q)) ||
      (c.vatnumber && c.vatnumber.toLowerCase().includes(q))
  );
}

export async function getProjects(): Promise<HoldedProject[]> {
  return fetchHolded<HoldedProject[]>(`${PROXY_BASE}/api/projects/v1/projects`);
}

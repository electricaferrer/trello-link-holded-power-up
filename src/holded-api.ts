import type { HoldedContact, HoldedProject } from './types';

// Cloudflare Worker proxy — update this after deploying the worker
const PROXY_URL = 'https://holded-proxy.mferrer.workers.dev/api/invoicing/v1';

async function fetchHolded<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${PROXY_URL}${path}`, {
    headers: { 'X-Holded-Key': apiKey },
  });
  if (!response.ok) {
    throw new Error(`Holded API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function searchContacts(apiKey: string, query: string): Promise<HoldedContact[]> {
  const contacts = await fetchHolded<HoldedContact[]>(apiKey, '/contacts');
  if (!query) return contacts;
  const q = query.toLowerCase();
  return contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.vatnumber && c.vatnumber.toLowerCase().includes(q))
  );
}

export async function getProjects(apiKey: string): Promise<HoldedProject[]> {
  return fetchHolded<HoldedProject[]>(apiKey, '/projects');
}

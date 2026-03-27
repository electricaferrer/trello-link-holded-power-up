import type { HoldedContact } from './types';

const STORAGE_KEY = 'holded_contacts_cache';
const TIMESTAMP_KEY = 'holded_contacts_cache_ts';

export function getCachedContacts(): HoldedContact[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedContacts(contacts: HoldedContact[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    localStorage.setItem(TIMESTAMP_KEY, String(Date.now()));
  } catch {
    // Storage full or unavailable — ignore
  }
}

export function getCacheTimestamp(): number {
  return Number(localStorage.getItem(TIMESTAMP_KEY)) || 0;
}

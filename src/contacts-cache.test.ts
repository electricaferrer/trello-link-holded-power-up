// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedContacts, setCachedContacts, getCacheTimestamp } from './contacts-cache';
import type { HoldedContact } from './types';

function makeContact(overrides: Partial<HoldedContact> = {}): HoldedContact {
  return {
    id: '1', customId: null, name: 'Test', code: null, vatnumber: '',
    tradeName: null, email: null, mobile: null, phone: null, type: '',
    iban: '', swift: '', groupId: '', clientRecord: 0, supplierRecord: 0,
    billAddress: { address: null, city: null, postalCode: '', province: null, country: '', countryCode: '', info: '' },
    customFields: [], defaults: {} as HoldedContact['defaults'],
    socialNetworks: [], tags: [], notes: [], contactPersons: [],
    shippingAddresses: [], isperson: 1, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('getCachedContacts', () => {
  it('returns null when cache is empty', () => {
    expect(getCachedContacts()).toBeNull();
  });

  it('returns contacts after setCachedContacts', () => {
    const contacts = [makeContact({ id: 'a', name: 'Alice' }), makeContact({ id: 'b', name: 'Bob' })];
    setCachedContacts(contacts);
    const cached = getCachedContacts();
    expect(cached).toHaveLength(2);
    expect(cached![0].name).toBe('Alice');
    expect(cached![1].name).toBe('Bob');
  });

  it('returns null if localStorage has invalid JSON', () => {
    localStorage.setItem('holded_contacts_cache', '{invalid');
    expect(getCachedContacts()).toBeNull();
  });
});

describe('setCachedContacts', () => {
  it('stores contacts and sets timestamp', () => {
    const before = Date.now();
    setCachedContacts([makeContact()]);
    const ts = getCacheTimestamp();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});

describe('getCacheTimestamp', () => {
  it('returns 0 when no cache exists', () => {
    expect(getCacheTimestamp()).toBe(0);
  });

  it('returns timestamp set by setCachedContacts', () => {
    setCachedContacts([makeContact()]);
    expect(getCacheTimestamp()).toBeGreaterThan(0);
  });
});

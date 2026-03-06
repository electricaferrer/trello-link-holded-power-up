import type { CardHoldedData, TrelloContext } from './types';

const STORAGE_KEY = 'holdedData';

export async function getCardData(t: TrelloContext): Promise<CardHoldedData> {
  const data = await t.get('card', 'shared', STORAGE_KEY);
  return (data as CardHoldedData) || {};
}

export async function setCardData(t: TrelloContext, data: CardHoldedData): Promise<void> {
  await t.set('card', 'shared', STORAGE_KEY, data);
}

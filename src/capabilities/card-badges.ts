import type { TrelloContext } from '../types';
import { getCardData } from '../storage';

// Inline SVG data URIs for badge icons (person + folder)
const PERSON_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b778c'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E";

const FOLDER_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b778c'%3E%3Cpath d='M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z'/%3E%3C/svg%3E";

export async function getCardBadges(t: unknown) {
  const ctx = t as TrelloContext;
  const data = await getCardData(ctx);
  const badges: Array<{ text: string; icon: string; color: string | null }> = [];

  if (data.contactName) {
    badges.push({
      text: data.contactName,
      icon: PERSON_ICON,
      color: null,
    });
  }

  if (data.projectName) {
    badges.push({
      text: data.projectName,
      icon: FOLDER_ICON,
      color: null,
    });
  }

  return badges;
}

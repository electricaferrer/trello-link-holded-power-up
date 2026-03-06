import { getCardBadges } from './capabilities/card-badges';
import { getCardButtons } from './capabilities/card-buttons';
import { getCardBackSection } from './capabilities/card-back-section';
import { getBoardButtons } from './capabilities/board-buttons';
import { CONTACT_ICON_URL } from './icons';

window.TrelloPowerUp.initialize({
  'card-buttons': (t: unknown) => getCardButtons(t),
  'card-badges': (t: unknown) => getCardBadges(t),
  'card-back-section': (t: unknown) => getCardBackSection(t, CONTACT_ICON_URL),
  'board-buttons': (t: unknown) => getBoardButtons(t),
});

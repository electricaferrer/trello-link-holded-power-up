import { getCardBadges } from './capabilities/card-badges';
import { getCardButtons } from './capabilities/card-buttons';
import { getCardBackSection } from './capabilities/card-back-section';
import { getBoardButtons } from './capabilities/board-buttons';

const ICON_URL = 'https://miquelferrerllompart.github.io/trello-link-holded-power-up/icon.svg';

window.TrelloPowerUp.initialize({
  'card-buttons': (t: unknown) => getCardButtons(t, ICON_URL),
  'card-badges': (t: unknown) => getCardBadges(t),
  'card-back-section': (t: unknown) => getCardBackSection(t, ICON_URL),
  'board-buttons': (t: unknown) => getBoardButtons(t, ICON_URL),
});

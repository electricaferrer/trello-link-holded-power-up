import { HOLDED_ICON_URL } from '../icons';
import type { TrelloContext } from '../types';

export function getCardButtons(t: unknown) {
  const ctx = t as TrelloContext;
  return [{
    icon: HOLDED_ICON_URL,
    text: '€ Generar informe económico',
    condition: 'signedIn',
    callback: () => ctx.popup({
      title: '€ Generar informe económico',
      url: './src/popups/report.html',
      height: 640,
    }),
  }];
}

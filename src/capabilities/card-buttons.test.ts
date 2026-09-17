import { describe, expect, it, vi } from 'vitest';
import { getCardButtons } from './card-buttons';

describe('card buttons capability', () => {
  it('opens the report form from the card Power-Ups menu', () => {
    const popup = vi.fn();
    const buttons = getCardButtons({ popup } as never);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].text).toBe('€ Generar informe económico');
    expect(buttons[0].condition).toBe('signedIn');
    buttons[0].callback();

    expect(popup).toHaveBeenCalledWith({
      title: '€ Generar informe económico',
      url: './src/popups/report.html',
      height: 640,
    });
  });
});

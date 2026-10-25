import { el } from '../ui.js';

// Zaślepka — widok zostanie wypełniony w kolejnym zadaniu.
export function mount(container, ctx, prefill) {
  container.append(el('div', { class: 'view' }, el('h2', null, 'Panel administratora'), el('p', { class: 'muted' }, 'Widok w przygotowaniu.')));
}

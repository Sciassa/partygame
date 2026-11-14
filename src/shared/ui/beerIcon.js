import { h } from '../util/dom.js';
import { getBeer } from '../avatars/beers.js';

/**
 * Iconcina CSS di un bicchiere di birra (liquido + schiuma), per liste e bottoni.
 * beerId null = bicchiere vuoto (giocatore disconnesso: la sua birra è tornata nel pool).
 */
export function beerIcon(beerId, size = 'md') {
  if (!beerId) return h('span', { class: `beer-icon beer-icon-${size} beer-icon-empty`, 'aria-hidden': 'true' });
  const beer = getBeer(beerId);
  return h(
    'span',
    { class: `beer-icon beer-icon-${size} glass-${beer.glass}`, style: { '--liquid': beer.liquid, '--foam': beer.foam }, 'aria-hidden': 'true' },
    h('span', { class: 'beer-icon-foam' }),
    h('span', { class: 'beer-icon-liquid' }),
  );
}

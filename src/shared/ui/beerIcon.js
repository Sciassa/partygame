import { h } from '../util/dom.js';
import { getBeer } from '../avatars/beers.js';

/** Iconcina CSS di un bicchiere di birra (liquido + schiuma), per liste e bottoni. */
export function beerIcon(beerId, size = 'md') {
  const beer = getBeer(beerId);
  return h(
    'span',
    { class: `beer-icon beer-icon-${size} glass-${beer.glass}`, style: { '--liquid': beer.liquid, '--foam': beer.foam }, 'aria-hidden': 'true' },
    h('span', { class: 'beer-icon-foam' }),
    h('span', { class: 'beer-icon-liquid' }),
  );
}

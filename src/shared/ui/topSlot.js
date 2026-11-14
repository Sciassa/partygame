import { h } from '../util/dom.js';

const REEL_SEGMENTS = ['TRIVIA', 'MINIGIOCO', 'FORTUNA', "FUSTO D'ORO"];
const REEL_MULTIPLIERS = ['x2', 'x3', '+100'];

/**
 * Top Slot stile game show: due rulli (spicchio + moltiplicatore) sopra la ruota.
 * Girano durante il lancio e si fermano svelando l'estrazione decisa dall'host.
 */
export function createTopSlot() {
  const reelA = h('div', { class: 'reel' }, h('div', { class: 'reel-strip' }));
  const reelB = h('div', { class: 'reel reel-small' }, h('div', { class: 'reel-strip' }));
  const el = h('div', { class: 'top-slot', 'aria-live': 'polite' }, h('div', { class: 'top-slot-title' }, 'TOP SLOT'), h('div', { class: 'top-slot-reels' }, reelA, reelB));
  let timers = [];

  const fill = (reel, items, final) => {
    const strip = reel.firstChild;
    strip.replaceChildren(...[...items, ...items, ...items, final].map((t) => h('div', { class: 'reel-item' }, t)));
    strip.style.setProperty('--loop', items.length); // giro continuo = un ciclo di simboli
    return strip;
  };

  return {
    el,
    /** Avvia i rulli e li ferma dopo `revealInMs` sul risultato. */
    spin(topSlot, revealInMs) {
      timers.forEach(clearTimeout);
      timers = [];
      el.classList.remove('revealed', 'hit');
      el.classList.add('show', 'spinning');
      el.dataset.key = `${topSlot.segmentLabel}|${topSlot.multiplierLabel}`;
      const a = fill(reelA, REEL_SEGMENTS, topSlot.segmentLabel);
      const b = fill(reelB, REEL_MULTIPLIERS, topSlot.multiplierLabel);
      for (const strip of [a, b]) {
        strip.style.transition = 'none';
        strip.style.transform = 'translateY(0)';
      }
      const reveal = () => {
        el.classList.remove('spinning');
        el.classList.add('revealed');
        for (const strip of [a, b]) {
          strip.style.transition = 'transform 0.6s cubic-bezier(0.2, 1.3, 0.4, 1)';
          strip.style.transform = `translateY(calc(-${strip.children.length - 1} * var(--reel-h)))`;
        }
      };
      if (revealInMs <= 0) reveal();
      else timers.push(setTimeout(reveal, revealInMs));
    },
    /** Mostra subito il risultato (es. chi si collega a ruota già ferma). */
    show(topSlot) {
      if (el.classList.contains('revealed') && el.dataset.key === `${topSlot.segmentLabel}|${topSlot.multiplierLabel}`) return;
      el.dataset.key = `${topSlot.segmentLabel}|${topSlot.multiplierLabel}`;
      this.spin(topSlot, 0);
    },
    hit() {
      el.classList.add('hit');
    },
    hide() {
      timers.forEach(clearTimeout);
      el.classList.remove('show', 'spinning', 'revealed', 'hit');
      delete el.dataset.key;
    },
  };
}

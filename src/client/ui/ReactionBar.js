import { h } from '../../shared/util/dom.js';
import { vibrate } from '../../shared/util/device.js';
import { EMOTE_COOLDOWN_MS, EMOTE_IDS } from '../../shared/game/counter.js';
import { EMOTES } from '../../shared/game/emotes.js';

/**
 * Barra delle reazioni sul telefono: CIN CIN · AHAHAH · BUUU · DAJE.
 * Cooldown di 2.5 s (lo stesso che applica l'host): tutti i tasti si "ricaricano" insieme,
 * con un anello che si riempie.
 *
 * @param {{ onEmote: (emote: string) => void }} opts
 */
export function createReactionBar({ onEmote }) {
  let readyAt = 0;
  let raf = 0;
  const buttons = EMOTE_IDS.map((id) => {
    const info = EMOTES[id];
    return h(
      'button',
      { type: 'button', class: 'react-btn', dataset: { emote: id }, style: { '--ec': info.color }, 'aria-label': info.label, onclick: () => fire(id) },
      h('span', { class: 'react-icon' }, info.icon),
      h('span', { class: 'react-label' }, info.label),
    );
  });
  const el = h('div', { class: 'react-bar' }, buttons);

  function fire(id) {
    const now = performance.now();
    if (now < readyAt) return;
    readyAt = now + EMOTE_COOLDOWN_MS;
    vibrate(18);
    onEmote(id);
    el.classList.add('cooling');
    const pressed = buttons.find((b) => b.dataset.emote === id);
    pressed?.classList.remove('pop');
    void pressed?.offsetWidth; // riavvia l'animazione
    pressed?.classList.add('pop');
    cancelAnimationFrame(raf);
    const loop = () => {
      const left = Math.max(0, readyAt - performance.now());
      el.style.setProperty('--cool', (left / EMOTE_COOLDOWN_MS).toFixed(3));
      if (left > 0) raf = requestAnimationFrame(loop);
      else el.classList.remove('cooling');
    };
    loop();
  }

  return {
    el,
    setVisible(visible) {
      el.classList.toggle('hidden', !visible);
    },
  };
}

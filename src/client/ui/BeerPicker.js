import { h, fill } from '../../shared/util/dom.js';
import { BEERS } from '../../shared/avatars/beers.js';
import { beerIcon } from '../../shared/ui/beerIcon.js';

/**
 * Modale «🍺 Cambia Birra»: griglia 3×4 in vetro smerigliato scuro.
 * Ogni birra è unica nella stanza:
 *  - occupata da un altro: opacità 0.35, non cliccabile, con il nome di chi la beve
 *  - la mia: bordo ambra 2px
 * La vista si aggiorna da sola a ogni BEER_POOL_SYNC (update), così due giocatori che puntano
 * la stessa birra vedono subito chi l'ha presa per primo.
 *
 * @param {{ getView: () => { assigned: Record<string,string>, players: Array, myId: string, canChange: boolean },
 *           onPick: (beerId:string) => void, firstTime?: boolean, onClose?: () => void }} opts
 */
export function openBeerPicker({ getView, onPick, firstTime = false, onClose }) {
  const grid = h('div', { class: 'beer-grid' });
  const note = h('p', { class: 'beer-note' });
  let pending = null;

  const close = () => {
    modal.remove();
    onClose?.();
  };

  function render() {
    const { assigned, players, myId, canChange } = getView();
    const names = new Map(players.map((p) => [p.id, p.name]));
    const ownerOf = new Map(Object.entries(assigned).map(([pid, beer]) => [beer, pid]));
    const myBeer = assigned[myId] ?? players.find((p) => p.id === myId)?.beer;
    if (pending && myBeer === pending) pending = null;
    fill(
      grid,
      BEERS.map((beer) => {
        const owner = ownerOf.get(beer.id);
        const mine = beer.id === myBeer;
        const taken = Boolean(owner) && owner !== myId;
        return h(
          'button',
          {
            class: `beer-option glass-card ${mine ? 'selected' : ''} ${taken ? 'taken' : ''} ${pending === beer.id ? 'pending' : ''}`,
            type: 'button',
            disabled: taken || !canChange,
            style: { '--accent': beer.accent, '--liquid': beer.liquid },
            onclick: () => {
              if (mine || taken) return;
              pending = beer.id;
              onPick(beer.id);
              render();
            },
          },
          h('span', { class: 'beer-swatch' }),
          beerIcon(beer.id, 'lg'),
          h('span', { class: 'beer-option-name' }, beer.name),
          taken ? h('span', { class: 'owner-badge' }, names.get(owner) ?? '?') : mine ? h('span', { class: 'owner-badge mine' }, 'la tua') : null,
        );
      }),
    );
    note.textContent = canChange ? 'Le birre in grigio sono già sul bancone di qualcun altro.' : '🔒 La ruota ha già girato: ti tieni la tua birra.';
  }

  const modal = h(
    'div',
    { class: 'modal beer-modal', onclick: (e) => e.target === modal && close() },
    h(
      'div',
      { class: 'modal-card glass-modal' },
      h('div', { class: 'eyebrow' }, firstTime ? 'Benvenuto al bancone' : 'Cambia birra'),
      h('h2', {}, firstTime ? 'Ti abbiamo servito questa. Va bene?' : '🍺 Scegli la tua birra'),
      grid,
      note,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, firstTime ? 'Va bene così' : 'Fatto'),
    ),
  );
  document.body.append(modal);
  render();
  return { update: render, close };
}

import { h } from '../../shared/util/dom.js';
import { BEERS } from '../../shared/avatars/beers.js';
import { beerIcon } from '../../shared/ui/beerIcon.js';

/**
 * Modale per scegliere la propria birra-avatar. Ogni birra è unica nella stanza:
 * quelle già prese da altri sono disattivate con il nome di chi le ha.
 *
 * @param {{ players:Array, myId:string, onPick:(beerId:string)=>void, firstTime?:boolean }} opts
 */
export function openBeerPicker({ players, myId, onPick, firstTime = false }) {
  const me = players.find((p) => p.id === myId);
  const owners = new Map(players.filter((p) => p.id !== myId).map((p) => [p.beer, p.name]));
  const close = () => modal.remove();

  const grid = h(
    'div',
    { class: 'beer-grid' },
    BEERS.map((beer) => {
      const owner = owners.get(beer.id);
      const mine = me?.beer === beer.id;
      return h(
        'button',
        {
          class: `beer-option ${mine ? 'selected' : ''}`,
          type: 'button',
          disabled: Boolean(owner),
          style: { '--accent': beer.accent },
          onclick: () => {
            if (!mine) onPick(beer.id);
            close();
          },
        },
        beerIcon(beer.id, 'lg'),
        h('span', { class: 'beer-option-name' }, beer.name),
        h('span', { class: 'beer-option-sub' }, owner ? `di ${owner}` : mine ? 'la tua' : beer.tagline),
      );
    }),
  );

  const modal = h(
    'div',
    { class: 'modal', onclick: (e) => e.target === modal && close() },
    h(
      'div',
      { class: 'modal-card modal-wide' },
      h('div', { class: 'eyebrow' }, firstTime ? 'Benvenuto al bancone' : 'Cambia birra'),
      h('h2', {}, firstTime ? 'Ti abbiamo servito questa. Va bene?' : 'Scegli la tua birra'),
      grid,
      h('button', { class: 'btn btn-ghost', onclick: close }, firstTime ? 'Va bene così' : 'Chiudi'),
    ),
  );
  document.body.append(modal);
  return close;
}

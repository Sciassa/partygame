import { h, fill } from '../../shared/util/dom.js';
import { vibrate } from '../../shared/util/device.js';
import { beerIcon } from '../../shared/ui/beerIcon.js';
import { COUNTER, SHOT_IDS } from '../../shared/game/counter.js';
import { SoundEngine } from '../../audio/SoundEngine.ts';

/**
 * «🍻 Bancone & Sottobanco»: foglio che sale dal basso sul telefono.
 * Tre sezioni: 🎯 Taglia · 🤫 Sottobanco · 🥃 Shot (uno nel taschino).
 * Si aggiorna in tempo reale (update) con lo stato pubblico e i dati privati.
 *
 * @param {{ getCtx: () => { s:object, p:object, meId:string }, send: (action:object) => void, onClose?: () => void }} opts
 */
export function openCounterSheet({ getCtx, send, onClose }) {
  const ui = { tab: 'bounty', target: null, amount: COUNTER.slipAmounts[0] };
  const body = h('div', { class: 'sheet-body' });
  const tabs = h('div', { class: 'sheet-tabs segmented' });
  const close = () => {
    sheet.classList.add('closing');
    setTimeout(() => sheet.remove(), 220);
    onClose?.();
  };
  const sheet = h(
    'div',
    { class: 'sheet-backdrop', onclick: (e) => e.target === sheet && close() },
    h(
      'div',
      { class: 'sheet' },
      h('div', { class: 'sheet-grip' }),
      h('div', { class: 'sheet-head' }, h('h2', {}, '🍻 Bancone & Sottobanco'), h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: close }, 'Chiudi')),
      tabs,
      body,
    ),
  );
  document.body.append(sheet);

  function render() {
    const { s, p, meId } = getCtx();
    const counter = p?.counter ?? {};
    const coins = p?.coins ?? 0;
    const others = s.players.filter((x) => x.id !== meId && x.connected);
    if (ui.target && !others.some((o) => o.id === ui.target)) ui.target = null;

    fill(
      tabs,
      [
        ['bounty', '🎯 Taglia'],
        ['slip', '🤫 Sottobanco'],
        ['shots', `🥃 Shot${counter.shot ? ' •' : ''}`],
      ].map(([id, label]) => h('button', { type: 'button', class: `seg-btn ${ui.tab === id ? 'active' : ''}`, onclick: () => ((ui.tab = id), render()) }, label)),
    );

    const closedNote = counter.open ? null : h('p', { class: 'sheet-closed' }, '🔒 Il bancone apre a inizio turno (negozio, scommesse, lancio).');
    const targetPicker = (filter = () => true, note = (o) => null) =>
      h(
        'div',
        { class: 'target-grid' },
        others.filter(filter).map((o) =>
          h(
            'button',
            { type: 'button', class: `target-btn ${ui.target === o.id ? 'active' : ''}`, style: { '--pc': o.color }, onclick: () => ((ui.target = o.id), render()) },
            beerIcon(o.beer, 'sm'),
            h('span', { class: 'target-name' }, o.name),
            note(o) ? h('span', { class: 'target-note' }, note(o)) : null,
          ),
        ),
        others.length ? null : h('p', { class: 'muted small' }, 'Nessun altro al bancone.'),
      );

    if (ui.tab === 'bounty') {
      const { cost, reward, turns } = COUNTER.bounty;
      const hasBounty = (o) => (counter.bounties ?? []).includes(o.id);
      fill(
        body,
        h('p', { class: 'sheet-desc' }, `Paga ${cost} Tappi e metti una taglia su un avversario per ${turns} turni: chi lo batte (Sfida 1v1, Asta) o gli fa perdere Tappi (adesivi, smascherandolo da Impostore) incassa ${reward} Tappi dalla banca.`),
        closedNote,
        targetPicker(() => true, (o) => (hasBounty(o) ? '🎯 già ricercato' : null)),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-block',
            disabled: !counter.open || !ui.target || coins < cost || others.some((o) => o.id === ui.target && hasBounty(o)),
            onclick: () => {
              send({ kind: 'counter_bounty', targetId: ui.target });
              vibrate(30);
              close();
            },
          },
          `🎯 Metti la taglia (${cost})`,
        ),
      );
    } else if (ui.tab === 'slip') {
      fill(
        body,
        h('p', { class: 'sheet-desc' }, 'Passa Tappi a un amico sotto il bancone. Sulla TV si vedrà solo «Movimento sospetto al bancone!». Uno per turno.'),
        closedNote,
        targetPicker(),
        h(
          'div',
          { class: 'segmented slip-amounts' },
          COUNTER.slipAmounts.map((a) => h('button', { type: 'button', class: `seg-btn ${ui.amount === a ? 'active' : ''}`, onclick: () => ((ui.amount = a), render()) }, `${a} Tappi`)),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary btn-block',
            disabled: !counter.open || counter.slipUsed || !ui.target || coins < ui.amount,
            onclick: () => {
              send({ kind: 'counter_slip', targetId: ui.target, amount: ui.amount });
              SoundEngine.playSneaky();
              close();
            },
          },
          counter.slipUsed ? 'Già fatto in questo turno' : `🤫 Passa ${ui.amount} Tappi`,
        ),
      );
    } else {
      const held = counter.shot ? COUNTER.shots[counter.shot] : null;
      const needsTarget = held?.target;
      fill(
        body,
        h('p', { class: 'sheet-desc' }, 'Uno shot alla volta nel taschino. Si usa nel tuo turno, prima di lanciare la ruota.'),
        closedNote,
        held
          ? h(
              'div',
              { class: 'shot-held' },
              h('div', { class: 'shot-title' }, `${held.icon} Nel taschino: ${held.name}`),
              h('p', { class: 'muted small' }, held.description),
              needsTarget ? targetPicker() : null,
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-primary btn-block',
                  disabled: !counter.canUseShot || (needsTarget && !ui.target),
                  onclick: () => {
                    send({ kind: 'counter_use', targetId: ui.target });
                    if (held.id === 'analcolica') SoundEngine.playSplash();
                    else SoundEngine.playShot();
                    vibrate([40, 30, 40]);
                    close();
                  },
                },
                counter.canUseShot ? (needsTarget ? `${held.icon} Lancialo addosso!` : `${held.icon} Bevi adesso`) : 'Usalo nel tuo turno, prima del lancio',
              ),
            )
          : null,
        h(
          'div',
          { class: 'shot-list' },
          SHOT_IDS.map((id) => {
            const shot = COUNTER.shots[id];
            return h(
              'button',
              {
                type: 'button',
                class: 'shot-card',
                disabled: !counter.open || Boolean(counter.shot) || coins < shot.price,
                onclick: () => {
                  send({ kind: 'counter_buy', shot: id });
                  vibrate(20);
                },
              },
              h('span', { class: 'shot-icon' }, shot.icon),
              h('span', { class: 'shot-text' }, h('b', {}, shot.name), h('span', { class: 'muted small' }, shot.description)),
              h('span', { class: 'price' }, `${shot.price}`),
            );
          }),
        ),
      );
    }
  }

  render();
  return { update: render, close, el: sheet };
}

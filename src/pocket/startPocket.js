import { MODE } from '../shared/protocol.js';
import { clear, h } from '../shared/util/dom.js';
import { createLocalLinkPair } from '../shared/net/Link.js';
import { HostCore } from '../host/HostCore.js';
import { ClientApp } from '../client/ClientApp.js';

/**
 * Modalità POCKET: niente schermo centrale. Il telefono di chi crea la stanza esegue
 * "invisibilmente" HostCore (stato + rete) e, in parallelo, la normale UI giocatore collegata
 * all'host tramite un LocalLink in memoria. Gli altri telefoni entrano via WebRTC come in Salotto.
 *
 * Limite noto: se il telefono host va in background o si blocca, il browser congela timer e
 * WebRTC e la partita si ferma per tutti. Per questo teniamo lo schermo acceso (Wake Lock)
 * e chiediamo conferma prima di chiudere la pagina.
 */
export async function startPocket(root, { name }) {
  clear(root).append(h('div', { class: 'screen-center' }, h('div', { class: 'loader' }), h('p', {}, 'Creo la stanza Pocket...')));

  const core = new HostCore({ mode: MODE.POCKET });
  let roomCode;
  try {
    roomCode = await core.start();
  } catch (err) {
    console.error(err);
    clear(root).append(
      h(
        'div',
        { class: 'screen-center' },
        h('h2', {}, 'Impossibile creare la stanza'),
        h('p', { class: 'muted' }, 'Controlla la connessione e riprova.'),
        h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Riprova'),
      ),
    );
    return;
  }

  const [hostSide, playerSide] = createLocalLinkPair();
  core.attachLocal(hostSide);

  window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
  });

  const app = new ClientApp(root, {
    roomCode,
    name,
    connect: async () => playerSide,
    canReconnect: false,
    isOwner: true,
  });
  app.start();
  return { core, app };
}

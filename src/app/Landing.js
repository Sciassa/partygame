import '../styles/landing.css';
import { APP_NAME, MAX_NAME_LENGTH, ROOM_CODE_LENGTH, normalizeRoomCode } from '../shared/config.js';
import { clear, h, toast } from '../shared/util/dom.js';
import { enterFullscreen, isIOS, isStandalone } from '../shared/util/device.js';
import { load, save } from '../shared/util/storage.js';
import { unlockAudio } from '../shared/audio/sfx.js';
import { canPromptInstall, promptInstall, pwa } from '../pwa/registerSW.js';

/**
 * Schermata iniziale. Tre strade:
 *  - 📺 Salotto: questo dispositivo diventa lo schermo/host
 *  - 📱 Pocket:  crei la stanza dal telefono e giochi anche tu
 *  - 🎮 Entra:   ti unisci con codice (o arrivi già dal QR con ?room=XXXX)
 * I moduli di ogni modalità sono caricati on-demand: un controller non scarica mai Three.js.
 */
export function renderLanding(root, { roomFromUrl = '' } = {}) {
  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Il tuo nome',
    maxLength: MAX_NAME_LENGTH,
    autocomplete: 'nickname',
    enterKeyHint: 'go',
    value: load('ruota.name', ''),
  });
  const codeInput = h('input', {
    class: 'input input-code',
    type: 'text',
    placeholder: 'CODICE',
    maxLength: ROOM_CODE_LENGTH,
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: false,
    enterKeyHint: 'go',
    value: roomFromUrl,
  });
  codeInput.addEventListener('input', () => (codeInput.value = normalizeRoomCode(codeInput.value)));

  const requireName = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.classList.add('shake');
      setTimeout(() => nameInput.classList.remove('shake'), 500);
      toast('Scrivi il tuo nome');
      return null;
    }
    save('ruota.name', name);
    return name;
  };

  const startSalotto = async () => {
    unlockAudio();
    const { startSalotto } = await import('../host/screen/HostScreen.js');
    startSalotto(root);
  };

  const startPocket = async () => {
    const name = requireName();
    if (!name) return;
    unlockAudio();
    enterFullscreen();
    const { startPocket } = await import('../pocket/startPocket.js');
    startPocket(root, { name });
  };

  const join = async () => {
    const code = normalizeRoomCode(codeInput.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      codeInput.focus();
      toast(`Il codice stanza ha ${ROOM_CODE_LENGTH} lettere`);
      return;
    }
    const name = requireName();
    if (!name) return;
    unlockAudio();
    enterFullscreen();
    const { startRemoteClient } = await import('../client/ClientApp.js');
    startRemoteClient(root, { roomCode: code, name });
  };

  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && roomFromUrl && join());
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());

  const logo = h('h1', { class: 'logo' }, h('span', { class: 'logo-wheel' }, '🎡'), h('span', {}, APP_NAME));
  const installEl = h('div', { class: 'install' });
  const updateEl = h('div', { class: 'update-banner' });

  let page;
  if (roomFromUrl) {
    // Arrivato dal QR code: solo nome + ENTRA, nient'altro da capire.
    page = h(
      'div',
      { class: 'landing landing-join' },
      logo,
      h('p', { class: 'muted' }, 'Stai entrando nella stanza'),
      h('div', { class: 'room-code' }, roomFromUrl),
      nameInput,
      h('button', { class: 'btn btn-primary btn-huge', onclick: join }, 'ENTRA'),
      h('a', { class: 'link', href: './' }, 'Altre opzioni'),
      installEl,
      updateEl,
    );
  } else {
    page = h(
      'div',
      { class: 'landing' },
      logo,
      h('p', { class: 'tagline' }, 'Gira la ruota. Vinci monete. Sabota gli amici.'),
      nameInput,
      h(
        'div',
        { class: 'cards' },
        h(
          'section',
          { class: 'card card-join' },
          h('h2', {}, '🎮 Entra in una stanza'),
          h('div', { class: 'row' }, codeInput, h('button', { class: 'btn btn-primary', onclick: join }, 'ENTRA')),
        ),
        h(
          'button',
          { class: 'card card-action', onclick: startPocket },
          h('h2', {}, '📱 Crea stanza Pocket'),
          h('p', {}, 'Niente TV: ognuno vede la ruota sul proprio telefono. Il tuo fa da host.'),
        ),
        h(
          'button',
          { class: 'card card-action', onclick: startSalotto },
          h('h2', {}, '📺 Schermo Salotto'),
          h('p', {}, 'Questo dispositivo è il tabellone (TV, PC, tablet). I telefoni sono i controller.'),
        ),
      ),
      installEl,
      updateEl,
    );
  }
  clear(root).append(page);

  // --- PWA: installazione e aggiornamenti
  const renderInstall = () => {
    clear(installEl);
    if (isStandalone()) return;
    if (canPromptInstall()) {
      installEl.append(h('button', { class: 'btn btn-ghost', onclick: () => promptInstall().then(renderInstall) }, '⬇️ Installa l\'app'));
    } else if (isIOS()) {
      installEl.append(h('p', { class: 'muted small' }, 'Per giocare a schermo intero: Condividi ', h('b', {}, '⎋'), ' → ', h('b', {}, 'Aggiungi alla schermata Home')));
    }
  };
  renderInstall();
  pwa.on('installable', renderInstall);

  const renderUpdate = (apply) => {
    if (!apply || !page.isConnected) return;
    clear(updateEl).append(h('span', {}, 'Nuova versione disponibile'), h('button', { class: 'btn btn-small', onclick: apply }, 'Aggiorna'));
    updateEl.classList.add('show');
  };
  renderUpdate(pwa.pendingUpdate);
  pwa.on('update', renderUpdate);

  if (!roomFromUrl && !nameInput.value) nameInput.focus();
}

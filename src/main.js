import './styles/base.css';
import { normalizeRoomCode, ROOM_CODE_LENGTH } from './shared/config.js';
import { preventZoomGestures } from './shared/util/device.js';
import { load } from './shared/util/storage.js';
import { registerServiceWorker } from './pwa/registerSW.js';
import { renderLanding } from './app/Landing.js';

registerServiceWorker();
preventZoomGestures();

const root = document.getElementById('app');
const params = new URLSearchParams(window.location.search);
const room = normalizeRoomCode(params.get('room'));

const SESSION_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const session = load('ruota.session');

if (room.length === ROOM_CODE_LENGTH && session?.roomCode === room && session.name && Date.now() - session.at < SESSION_MAX_AGE_MS) {
  // Eravamo già in questa stanza (reload, PWA riaperta): rientro diretto, l'host ci riconosce dal clientId
  import('./client/ClientApp.js').then(({ startRemoteClient }) => startRemoteClient(root, { roomCode: room, name: session.name }));
} else {
  renderLanding(root, { roomFromUrl: room.length === ROOM_CODE_LENGTH ? room : '' });
}

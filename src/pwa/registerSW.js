import { Emitter } from '../shared/Emitter.js';

/**
 * Registra il Service Worker (solo in build di produzione) ed espone:
 *  - pwa.on('update', apply)  -> c'è una nuova versione; chiama apply() per attivarla e ricaricare
 *  - pwa.on('installable')    -> Chrome/Android: si può mostrare il bottone "Installa"
 *  - pwa.promptInstall()
 */
export const pwa = new Emitter();
/** Funzione per applicare un aggiornamento già scaricato (o null). */
pwa.pendingUpdate = null;
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  pwa.emit('installable');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
});

export function canPromptInstall() {
  return deferredInstallPrompt !== null;
}

export async function promptInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return outcome === 'accepted';
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

      // Ricarichiamo SOLO quando l'utente ha accettato un aggiornamento. Alla primissima visita il
      // SW nuovo fa clients.claim() e scatena 'controllerchange': ricaricare lì riporterebbe alla
      // home chi ha appena creato/raggiunto una stanza.
      let userAccepted = false;
      const announce = (worker) => {
        pwa.pendingUpdate = () => {
          userAccepted = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
        pwa.emit('update', pwa.pendingUpdate);
      };

      if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker);
        });
      });

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !userAccepted) return;
        reloading = true;
        window.location.reload();
      });
    } catch (err) {
      console.warn('[pwa] registrazione service worker fallita', err);
    }
  });
}

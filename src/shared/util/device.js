/** Utility per far sembrare la web app un'app nativa sui telefoni. */

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Vibrazione (Android). Su iOS non esiste: no-op silenzioso. */
export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignorato */
  }
}

/**
 * Schermo sempre acceso durante la partita (Screen Wake Lock API).
 * Il lock viene rilasciato dal browser quando la pagina va in background: lo riprendiamo al ritorno.
 */
export function keepScreenOn() {
  if (!('wakeLock' in navigator)) return;
  let lock = null;
  const acquire = async () => {
    if (document.visibilityState !== 'visible' || lock) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } catch {
      /* batteria scarica, permessi... non è critico */
    }
  };
  document.addEventListener('visibilitychange', acquire);
  acquire();
}

/**
 * Fullscreen nel browser (non installato) su Android. Va chiamato dentro un gesto dell'utente.
 * Su iPhone l'API non esiste per elementi non-video: lì serve "Aggiungi a Home".
 */
export async function enterFullscreen() {
  if (isStandalone() || document.fullscreenElement || !isTouchDevice()) return;
  const el = document.documentElement;
  try {
    await el.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    /* rifiutato: pazienza */
  }
}

/** Impedisce pinch-zoom e doppio tap-zoom su iOS (che ignora user-scalable=no). */
export function preventZoomGestures() {
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 300 && !e.target.closest('input, textarea')) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
}

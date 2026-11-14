import { h } from '../../shared/util/dom.js';
import { vibrate } from '../../shared/util/device.js';

const MIN_SWIPE_PX = 40;
const MIN_FORCE = 0.12;
const CHARGE_PERIOD_MS = 1100; // tempo per andare da 0 a 1 tenendo premuto

/**
 * Controller per lanciare la ruota. Due modi, stessa uscita: onSpin(force 0..1), una sola volta.
 *  1. SWIPE sull'area grande: conta la velocità del "colpo" finale, non la lunghezza del gesto
 *  2. TIENI PREMUTO il tasto: la barra oscilla 0→1→0, rilasci quando ti piace
 * Dopo il lancio mostra la forza usata e si disattiva.
 */
export function createSpinPad({ onSpin }) {
  let fired = false;
  const forceValue = h('div', { class: 'force-value' }, '');
  const forceBar = h('div', { class: 'force-bar' }, h('div', { class: 'force-bar-fill' }));

  const showForce = (force) => {
    const pct = Math.round(force * 100);
    forceValue.textContent = `${pct}%`;
    forceBar.style.setProperty('--force', force);
  };

  const fire = (raw) => {
    if (fired) return;
    fired = true;
    const force = Math.min(1, Math.max(MIN_FORCE, raw));
    showForce(force);
    root.classList.add('fired');
    vibrate(force > 0.8 ? [30, 30, 60] : 40);
    onSpin(force);
  };

  // ---------------------------------------------------- swipe
  const dial = h('div', { class: 'swipe-dial', 'aria-hidden': 'true' }, h('div', { class: 'swipe-dial-mark' }));
  const zone = h(
    'div',
    { class: 'swipe-zone', role: 'button', 'aria-label': 'Swipa per lanciare la ruota' },
    dial,
    h('div', { class: 'swipe-label' }, 'Swipa per lanciare'),
    h('div', { class: 'swipe-hint' }, 'più veloce = più forte'),
    forceValue,
  );
  let samples = [];
  let pointerId = null;
  let dialAngle = 0;

  zone.addEventListener('pointerdown', (e) => {
    if (fired) return;
    pointerId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    zone.classList.add('active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const prev = samples[samples.length - 1];
    samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (samples.length > 40) samples.shift();
    // la manopola segue il dito: feedback immediato, sensazione di "afferrare" la ruota
    dialAngle += (e.clientX - prev.x - (e.clientY - prev.y)) * 0.6;
    dial.style.transform = `rotate(${dialAngle}deg)`;
    showForce(Math.min(1, swipeForce(samples)));
  });
  const endSwipe = (e, cancelled) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    zone.classList.remove('active');
    if (cancelled || samples.length < 2) return resetPreview();
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < MIN_SWIPE_PX) return resetPreview();
    fire(swipeForce(samples));
  };
  const resetPreview = () => {
    forceValue.textContent = '';
    forceBar.style.setProperty('--force', 0);
  };
  zone.addEventListener('pointerup', (e) => endSwipe(e, false));
  zone.addEventListener('pointercancel', (e) => endSwipe(e, true));

  // ---------------------------------------------------- tieni premuto
  const button = h(
    'button',
    { class: 'btn btn-spin', type: 'button' },
    h('span', { class: 'btn-spin-label' }, 'Tieni premuto · rilascia'),
  );
  let chargeStart = 0;
  let raf = 0;
  const chargeValue = (now) => {
    const x = ((now - chargeStart) % (CHARGE_PERIOD_MS * 2)) / CHARGE_PERIOD_MS;
    return x <= 1 ? x : 2 - x; // ping-pong
  };
  const loop = (now) => {
    showForce(chargeValue(now));
    raf = requestAnimationFrame(loop);
  };
  button.addEventListener('pointerdown', (e) => {
    if (fired) return;
    button.setPointerCapture(e.pointerId);
    chargeStart = performance.now();
    button.classList.add('charging');
    vibrate(15);
    raf = requestAnimationFrame(loop);
  });
  const release = (cancelled) => {
    if (!button.classList.contains('charging')) return;
    cancelAnimationFrame(raf);
    button.classList.remove('charging');
    if (cancelled) return resetPreview();
    fire(chargeValue(performance.now()));
  };
  button.addEventListener('pointerup', () => release(false));
  button.addEventListener('pointercancel', () => release(true));
  button.addEventListener('contextmenu', (e) => e.preventDefault());

  const root = h('div', { class: 'spin-pad' }, zone, forceBar, button);
  root.destroy = () => cancelAnimationFrame(raf);
  return root;
}

/**
 * Forza dello swipe: velocità (px/ms) sugli ultimi ~90 ms, normalizzata sulla diagonale dello
 * schermo così un telefono piccolo e un tablet richiedono lo stesso "colpo".
 */
function swipeForce(samples) {
  const last = samples[samples.length - 1];
  const recent = samples.filter((s) => last.t - s.t <= 90);
  const start = recent[0] === last ? samples[Math.max(0, samples.length - 2)] : recent[0];
  const dt = Math.max(8, last.t - start.t);
  const speed = Math.hypot(last.x - start.x, last.y - start.y) / dt;
  const diag = Math.hypot(window.innerWidth, window.innerHeight);
  return speed / (diag * 0.0035);
}

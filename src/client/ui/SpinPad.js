import { h } from '../../shared/util/dom.js';
import { vibrate } from '../../shared/util/device.js';

const MIN_SWIPE_PX = 50;
const MIN_POWER = 0.15;
const CHARGE_PERIOD_MS = 1100; // tempo per andare da 0 a 1 tenendo premuto

/**
 * Controller per girare la ruota, due modi:
 *  1. SWIPE: trascina e lancia; la velocità del gesto = potenza
 *  2. TIENI PREMUTO il bottone: la barra oscilla 0→1→0, rilascia al momento giusto
 * onSpin(power: 0..1) viene chiamato una sola volta, poi il pad si disattiva.
 */
export function createSpinPad({ onSpin }) {
  let fired = false;
  const fire = (power) => {
    if (fired) return;
    fired = true;
    root.classList.add('fired');
    vibrate(40);
    onSpin(Math.min(1, Math.max(MIN_POWER, power)));
  };

  // ---------------------------------------------------- swipe
  const arrow = h('div', { class: 'swipe-arrow' }, '⟳');
  const zone = h('div', { class: 'swipe-zone', role: 'button', 'aria-label': 'Swipa per girare la ruota' },
    arrow,
    h('div', { class: 'swipe-label' }, 'SWIPA PER GIRARE'),
  );
  let samples = [];
  let pointerId = null;

  zone.addEventListener('pointerdown', (e) => {
    if (fired) return;
    pointerId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    zone.classList.add('active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (samples.length > 30) samples.shift();
    const first = samples[0];
    arrow.style.transform = `translate(${(e.clientX - first.x) * 0.4}px, ${(e.clientY - first.y) * 0.4}px) rotate(${(e.clientX - first.x) * 0.8}deg)`;
  });
  const endSwipe = (e, cancelled) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    zone.classList.remove('active');
    arrow.style.transform = '';
    if (cancelled || samples.length < 2) return;
    const last = samples[samples.length - 1];
    const first = samples[0];
    if (Math.hypot(last.x - first.x, last.y - first.y) < MIN_SWIPE_PX) return;
    // velocità sugli ultimi ~100ms: conta il "colpo" finale, non tutto il trascinamento
    const recent = samples.filter((s) => last.t - s.t <= 100);
    const start = recent[0] === last ? samples[samples.length - 2] : recent[0];
    const dt = Math.max(1, last.t - start.t);
    const speed = Math.hypot(last.x - start.x, last.y - start.y) / dt; // px/ms
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    fire(speed / (diag * 0.004));
  };
  zone.addEventListener('pointerup', (e) => endSwipe(e, false));
  zone.addEventListener('pointercancel', (e) => endSwipe(e, true));

  // ---------------------------------------------------- tieni premuto
  const meterFill = h('div', { class: 'power-fill' });
  const button = h('button', { class: 'btn btn-spin', type: 'button' },
    h('span', { class: 'btn-spin-label' }, 'TIENI PREMUTO'),
    h('div', { class: 'power-meter' }, meterFill),
  );
  let chargeStart = 0;
  let raf = 0;
  const chargeValue = (now) => {
    const x = ((now - chargeStart) % (CHARGE_PERIOD_MS * 2)) / CHARGE_PERIOD_MS;
    return x <= 1 ? x : 2 - x; // ping-pong
  };
  const loop = (now) => {
    meterFill.style.transform = `scaleX(${chargeValue(now)})`;
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
    if (!cancelled) fire(chargeValue(performance.now()));
    meterFill.style.transform = 'scaleX(0)';
  };
  button.addEventListener('pointerup', () => release(false));
  button.addEventListener('pointercancel', () => release(true));
  button.addEventListener('contextmenu', (e) => e.preventDefault());

  const root = h('div', { class: 'spin-pad' }, zone, button);
  root.destroy = () => cancelAnimationFrame(raf);
  return root;
}

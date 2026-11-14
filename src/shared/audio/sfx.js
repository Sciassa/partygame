/**
 * Effetti sonori sintetizzati con WebAudio: zero file audio da scaricare.
 * L'AudioContext si sblocca solo dopo un gesto dell'utente (unlock()).
 */
let ctx = null;
let lastTick = 0;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function blip({ freq = 800, duration = 0.05, type = 'square', gain = 0.08, slideTo = null, delay = 0 }) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sfx = {
  /** Il "tic" del puntatore che sbatte sui pioli. */
  tick() {
    const now = performance.now();
    if (now - lastTick < 35) return;
    lastTick = now;
    blip({ freq: 1400, duration: 0.03, type: 'triangle', gain: 0.06 });
  },
  spinStart() {
    blip({ freq: 220, slideTo: 880, duration: 0.35, type: 'sawtooth', gain: 0.05 });
  },
  win() {
    [523, 659, 784, 1046].forEach((freq, i) => blip({ freq, duration: 0.18, type: 'square', gain: 0.06, delay: i * 0.09 }));
  },
  join() {
    blip({ freq: 660, duration: 0.08, type: 'sine', gain: 0.08 });
    blip({ freq: 990, duration: 0.1, type: 'sine', gain: 0.08, delay: 0.08 });
  },
};

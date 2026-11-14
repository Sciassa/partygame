import { TAU, mod, pointerLocalAngle } from '../../shared/wheel/kinematics.js';
import { randomFloat, randomInt } from '../../shared/util/random.js';

/**
 * "Fisica" autoritativa della ruota, solo lato host.
 *
 * L'esito è deciso PRIMA dell'animazione con un random crittografico (equo e non manipolabile
 * da un client), poi si calcola un piano di spin che atterra esattamente su quello spicchio.
 * La forza dello swipe non cambia le probabilità: cambia giri, durata e spettacolo.
 *
 * In futuro: i pesi per spicchio (adesivi "calamita", ecc.) entreranno in pickTargetIndex().
 */
export const SPIN_LIMITS = Object.freeze({
  minTurns: 3,
  maxTurns: 8,
  minDurationMs: 5000,
  maxDurationMs: 8500,
});

export function clampPower(power) {
  const p = Number(power);
  return Number.isFinite(p) ? Math.min(Math.max(p, 0), 1) : 0.5;
}

export function pickTargetIndex(segmentCount, weights = null) {
  if (!weights) return randomInt(0, segmentCount - 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = randomFloat() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * @param {number} fromAngle  angolo attuale della ruota
 * @param {number} power      0..1 (dallo swipe o dal tasto)
 * @param {number} segmentCount
 * @returns {{ from:number, to:number, duration:number, targetIndex:number }}
 */
export function planSpin(fromAngle, power, segmentCount, weights = null) {
  const p = clampPower(power);
  const s = TAU / segmentCount;
  const targetIndex = pickTargetIndex(segmentCount, weights);

  // Atterra dentro lo spicchio, lontano dai bordi (niente "era sul confine!" ambigui)
  const inside = 0.15 + randomFloat() * 0.7;
  const targetLocal = (targetIndex + inside) * s;
  const turns = Math.round(SPIN_LIMITS.minTurns + p * (SPIN_LIMITS.maxTurns - SPIN_LIMITS.minTurns));
  const delta = mod(targetLocal - pointerLocalAngle(fromAngle), TAU) + turns * TAU;

  const duration = Math.round(
    SPIN_LIMITS.minDurationMs + p * (SPIN_LIMITS.maxDurationMs - SPIN_LIMITS.minDurationMs) + randomFloat() * 600,
  );

  // Rotazione oraria = angolo decrescente. Normalizziamo `to` per non far crescere i numeri all'infinito.
  const from = mod(fromAngle, TAU);
  return { from, to: from - delta, duration, targetIndex };
}

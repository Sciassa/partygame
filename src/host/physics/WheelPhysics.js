import { FRICTION, TAU, createSpinPlan, pointerLocalAngle, segmentIndexAt } from '../../shared/wheel/kinematics.js';
import { randomFloat } from '../../shared/util/random.js';

/**
 * Motore fisico autoritativo della ruota (solo host).
 *
 * 1. LANCIO: la forza del giocatore (0..1) diventa una velocità angolare iniziale ω0.
 * 2. Si aggiunge una variazione casuale (crittografica) di ±JITTER su ω0. La forza conta davvero
 *    (più forte = più giri e più tempo), ma ±12% di ω0 sposta l'arrivo di più di un giro intero:
 *    nessuno può "mirare" uno spicchio dosando lo swipe, e l'esito resta equo.
 * 3. ATTRITO: il moto è calcolato in forma chiusa (vedi shared/wheel/kinematics.js), quindi la
 *    ruota si ferma nello stesso punto su host e client.
 * 4. RISOLUZIONE: lo spicchio vincente si ricava dall'angolo finale con aritmetica modulo 2π.
 */
export const LAUNCH = Object.freeze({
  minOmega: 9, // rad/s con forza 0   (~1.4 giri/s → circa 2 giri totali, ~4 s)
  maxOmega: 28, // rad/s con forza 1   (~4.5 giri/s → circa 10 giri totali, ~7 s)
  jitter: 0.12, // ±12% casuale su ω0
});

export function clampForce(force) {
  const f = Number(force);
  return Number.isFinite(f) ? Math.min(Math.max(f, 0), 1) : 0.5;
}

/**
 * Pianifica uno spin a partire dalla forza del lancio.
 * @param {number} fromAngle angolo attuale della ruota (rad)
 * @param {number} force     0..1, dallo swipe o dal tasto del telefono
 */
export function planSpin(fromAngle, force, friction = FRICTION) {
  const f = clampForce(force);
  // curva leggermente "ease-in": i lanci deboli restano controllabili, quelli forti esplodono
  const base = LAUNCH.minOmega + (LAUNCH.maxOmega - LAUNCH.minOmega) * f ** 1.2;
  const omega0 = base * (1 + (randomFloat() * 2 - 1) * LAUNCH.jitter);
  return { ...createSpinPlan(fromAngle, omega0, friction), force: f };
}

/**
 * Su quale spicchio si è fermato il puntatore?
 * Il puntatore è fisso in alto; la ruota ha ruotato di `finalAngle`. Riportiamo il puntatore nello
 * spazio locale della ruota (-angolo, modulo 2π) e dividiamo per l'ampiezza di uno spicchio.
 */
export function resolveStop(finalAngle, segmentCount) {
  const segmentAngle = TAU / segmentCount;
  const local = pointerLocalAngle(finalAngle); // 0..2π
  const index = segmentIndexAt(finalAngle, segmentCount);
  const offset = (local - index * segmentAngle) / segmentAngle; // 0..1: posizione dentro lo spicchio
  return {
    index,
    pointerLocalDeg: (local * 180) / Math.PI,
    offsetInSegment: offset,
    nearEdge: offset < 0.04 || offset > 0.96, // "sul filo"
  };
}

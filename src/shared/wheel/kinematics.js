/**
 * Cinematica della ruota: funzioni PURE e deterministiche, condivise da host e client.
 *
 * MODELLO FISICO (attrito)
 * La ruota riceve una velocità angolare iniziale ω0 (dal lancio) e rallenta per due attriti:
 *   - viscoso  (k,  1/s):    proporzionale alla velocità → frena tanto quando gira forte (aria, perno)
 *   - radente  (mu, rad/s²): costante → domina a bassa velocità e la ferma in un tempo finito
 *
 *   dω/dt = -mu - k·ω
 *
 * Soluzione in forma chiusa (niente integrazione frame-per-frame):
 *   ω(t) = (ω0 + mu/k)·e^(-k·t) - mu/k
 *   θ(t) = (ω0 + mu/k)·(1 - e^(-k·t))/k - (mu/k)·t
 *   si ferma a  T = ln(1 + k·ω0/mu) / k
 *
 * Perché la forma chiusa e non uno step di Eulero dentro requestAnimationFrame?
 * Con l'integrazione numerica la posizione finale dipende dai dt dei frame: TV a 60 Hz, telefono a
 * 120 Hz e un frame perso darebbero tre angoli finali diversi. La formula invece dà lo stesso
 * angolo ovunque. requestAnimationFrame la campiona a ogni frame: θ(tempo trascorso).
 *
 * Convenzione angoli:
 *  - la ruota ruota attorno all'asse Z; angolo positivo = antiorario (come Three.js)
 *  - il puntatore è fisso in alto (+Y)
 *  - lo spicchio i occupa, nello spazio locale della ruota, gli angoli [i*s, (i+1)*s)
 *    misurati da +Y in senso antiorario, con s = 2π / N
 *  - la ruota gira in senso orario (direction = -1), quindi l'indice sotto il puntatore cresce
 */
export const TAU = Math.PI * 2;

/** Attriti di default (l'host li mette nel piano di spin: i client usano quelli del piano). */
export const FRICTION = Object.freeze({
  k: 0.32, // viscoso, 1/s
  mu: 0.85, // radente, rad/s²
});

export function mod(x, m) {
  return ((x % m) + m) % m;
}

/** Angolo locale della ruota che si trova sotto al puntatore (0..2π). */
export function pointerLocalAngle(wheelAngle) {
  return mod(-wheelAngle, TAU);
}

/**
 * Disposizione degli spicchi: [{ start, end }] in angoli locali (da +Y, antiorario), 0..2π.
 * Accetta un numero (spicchi uguali) o l'array degli spicchi con `size` (1 = normale;
 * l'adesivo «Espansione» la porta a 2 o 3, rubando spazio agli altri).
 */
export function segmentLayout(segmentsOrCount) {
  const sizes = typeof segmentsOrCount === 'number' ? Array(segmentsOrCount).fill(1) : segmentsOrCount.map((s) => s.size ?? 1);
  const total = sizes.reduce((a, b) => a + b, 0);
  let acc = 0;
  return sizes.map((size) => {
    const start = (acc / total) * TAU;
    acc += size;
    return { start, end: (acc / total) * TAU };
  });
}

/** Indice dello spicchio sotto al puntatore. `layout` = numero di spicchi, array di spicchi o layout. */
export function segmentIndexAt(wheelAngle, layout) {
  const slots = typeof layout === 'number' || !('start' in (layout[0] ?? {})) ? segmentLayout(layout) : layout;
  const a = pointerLocalAngle(wheelAngle);
  for (let i = 0; i < slots.length; i++) if (a >= slots[i].start && a < slots[i].end) return i;
  return slots.length - 1;
}

/**
 * Piano "ad aggancio" (non fisico): porta la ruota da `fromAngle` a far stare il puntatore su
 * `targetLocal` con un ease-out. Serve alla Calamita, che fa "scivolare" la ruota sullo spicchio vicino.
 */
export function createEasePlan(fromAngle, targetLocal, durationMs = 1100) {
  const from = mod(fromAngle, TAU);
  let delta = mod(targetLocal - pointerLocalAngle(from), TAU);
  if (delta > Math.PI) delta -= TAU; // la via più corta, anche all'indietro
  return { kind: 'ease', from, to: from - delta, duration: durationMs, direction: delta >= 0 ? -1 : 1 };
}

/** Tempo di arresto in secondi. */
export function stopTime(omega0, { k, mu }) {
  return Math.log(1 + (k * omega0) / mu) / k;
}

/** Angolo percorso (rad, sempre ≥ 0) dopo t secondi. */
export function travelAt(omega0, t, { k, mu }) {
  return ((omega0 + mu / k) * (1 - Math.exp(-k * t))) / k - (mu / k) * t;
}

/** Velocità angolare (rad/s, ≥ 0) dopo t secondi. */
export function speedAt(omega0, t, { k, mu }) {
  return Math.max(0, (omega0 + mu / k) * Math.exp(-k * t) - mu / k);
}

/**
 * Costruisce il piano di spin a partire da angolo attuale e velocità iniziale.
 * Il piano è tutto ciò che serve per riprodurre lo spin identico su qualsiasi dispositivo.
 * @returns {{ from:number, to:number, omega0:number, k:number, mu:number, direction:number, duration:number }}
 */
export function createSpinPlan(fromAngle, omega0, friction = FRICTION, direction = -1) {
  const T = stopTime(omega0, friction);
  const from = mod(fromAngle, TAU); // niente numeri che crescono all'infinito
  return {
    from,
    to: from + direction * travelAt(omega0, T, friction),
    omega0,
    k: friction.k,
    mu: friction.mu,
    direction,
    duration: Math.round(T * 1000), // ms
  };
}

/** Angolo della ruota dopo `elapsedMs` dall'inizio dello spin. */
export function angleAt(plan, elapsedMs) {
  if (elapsedMs >= plan.duration) return plan.to;
  if (plan.kind === 'ease') {
    const x = Math.max(0, elapsedMs) / plan.duration;
    return plan.from + (plan.to - plan.from) * (1 - (1 - x) ** 3);
  }
  const t = Math.max(0, elapsedMs) / 1000;
  return plan.from + plan.direction * travelAt(plan.omega0, t, plan);
}

/** Velocità angolare in rad/s (usata per l'animazione del puntatore e per gli effetti). */
export function angularVelocityAt(plan, elapsedMs) {
  if (elapsedMs >= plan.duration) return 0;
  if (plan.kind === 'ease') {
    const x = Math.max(0, elapsedMs) / plan.duration;
    return (Math.abs(plan.to - plan.from) * 3 * (1 - x) ** 2) / (plan.duration / 1000);
  }
  return speedAt(plan.omega0, Math.max(0, elapsedMs) / 1000, plan);
}

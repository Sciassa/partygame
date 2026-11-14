/**
 * Cinematica della ruota: funzioni PURE e deterministiche, condivise da host e client.
 *
 * L'host decide l'esito (vedi host/physics/WheelPhysics.js) e produce un "piano di spin":
 *   { from, to, duration }   (angoli in radianti, durata in ms)
 * Ogni dispositivo che renderizza la ruota (TV in Salotto, tutti i telefoni in Pocket) calcola
 * angleAt(plan, t) localmente: niente stream di posizioni in rete, solo 1 messaggio per spin,
 * e la ruota si ferma esattamente sullo stesso angolo ovunque.
 *
 * Convenzione angoli:
 *  - la ruota ruota attorno all'asse Z; angolo positivo = antiorario (come Three.js)
 *  - il puntatore è fisso in alto (+Y)
 *  - lo spicchio i occupa, nello spazio locale della ruota, gli angoli [i*s, (i+1)*s)
 *    misurati da +Y in senso antiorario, con s = 2π / N
 *  - la ruota gira in senso orario (angolo decrescente), quindi l'indice sotto il puntatore cresce
 */
export const TAU = Math.PI * 2;

export function mod(x, m) {
  return ((x % m) + m) % m;
}

/** Angolo locale della ruota che si trova sotto al puntatore. */
export function pointerLocalAngle(wheelAngle) {
  return mod(-wheelAngle, TAU);
}

export function segmentIndexAt(wheelAngle, segmentCount) {
  return Math.floor(pointerLocalAngle(wheelAngle) / (TAU / segmentCount)) % segmentCount;
}

/**
 * Decelerazione "quartica": parte veloce, lunga suspense finale (stile game show).
 * La velocità iniziale è 4*Δ/T e scende a 0 in modo morbido.
 */
export function spinEase(x) {
  const t = Math.min(Math.max(x, 0), 1);
  return 1 - (1 - t) ** 4;
}

export function angleAt(plan, elapsedMs) {
  if (elapsedMs >= plan.duration) return plan.to;
  return plan.from + (plan.to - plan.from) * spinEase(elapsedMs / plan.duration);
}

/** Velocità angolare (rad/ms) — usata per l'animazione del puntatore/flapper. */
export function angularVelocityAt(plan, elapsedMs) {
  const x = Math.min(Math.max(elapsedMs / plan.duration, 0), 1);
  return ((plan.to - plan.from) * 4 * (1 - x) ** 3) / plan.duration;
}

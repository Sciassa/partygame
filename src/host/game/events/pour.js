import { withEvent } from './common.js';

const POUR_MS = 14000;
const REVEAL_MS = 6000;
export const POUR_TARGET = 0.95;
const PRIZES = [100, 50, 25];

/**
 * LA SPILLATURA PERFETTA: si tiene premuto per riempire il boccale (sul telefono).
 * Oltre il 40% il livello diventa invisibile. Vince chi si ferma più vicino al 95%;
 * chi supera il 100% trabocca e prende zero. Premi: 100 / 50 / 25.
 */
export async function runPour(engine, { lander }) {
  const participants = engine.connected();
  await withEvent(engine, { kind: 'pour', stage: 'pour', done: [], target: POUR_TARGET, hideAfter: 0.4, fillMs: 2600, landerId: lander.id }, async (event) => {
    const levels = new Map();
    await engine.collect({
      ms: POUR_MS,
      players: participants,
      onInput: (pid, a) => {
        if (a.kind !== 'pour' || levels.has(pid)) return false;
        const level = Number(a.level);
        if (!Number.isFinite(level)) return false;
        levels.set(pid, Math.min(1.5, Math.max(0, level)));
        event.done.push(pid);
        return true;
      },
      isComplete: () => levels.size >= participants.length,
    });

    const valid = [...levels].filter(([, level]) => level <= 1).sort((x, y) => Math.abs(x[1] - POUR_TARGET) - Math.abs(y[1] - POUR_TARGET));
    const results = participants.map((p) => {
      const level = levels.get(p.id);
      const rank = valid.findIndex(([id]) => id === p.id);
      const delta = rank >= 0 && rank < PRIZES.length ? engine.award(p, PRIZES[rank], { reason: 'Spillatura', boostable: true }) : 0;
      return { playerId: p.id, level: level ?? null, overflow: level !== undefined && level > 1, rank: rank >= 0 ? rank + 1 : null, delta };
    });
    const best = valid[0] && engine.state.getPlayer(valid[0][0]);
    engine.line(best ? `🍺 Spillatura perfetta: vince ${best.name} con il ${Math.round(valid[0][1] * 100)}%` : '🍺 Spillatura: tutti i boccali sono traboccati!', 'bonus');
    Object.assign(event, { stage: 'reveal', results });
    engine.changed();
    await engine.sleep(REVEAL_MS);
  });
}

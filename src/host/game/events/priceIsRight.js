import { NUMBER_QUESTIONS } from '../../../data/numbers.ts';
import { withEvent } from './common.js';

const GUESS_MS = 20000;
const REVEAL_MS = 7000;

/**
 * HIGHER / LOWER — IL PREZZO È GIUSTO: una curiosità numerica, ognuno indica un valore
 * con slider o tastierino. Il più vicino vince 100 Tappi (150 se esatto), il secondo 50.
 */
export async function runPriceIsRight(engine, { lander }) {
  const participants = engine.connected();
  const fresh = NUMBER_QUESTIONS.filter((q) => !engine.usedNumbers.has(q.id));
  const q = engine.pick(fresh.length ? fresh : NUMBER_QUESTIONS);
  engine.usedNumbers.add(q.id);

  await withEvent(
    engine,
    { kind: 'price', stage: 'guess', question: q.question, unit: q.unit ?? '', min: q.min, max: q.max, step: q.step, done: [], landerId: lander.id },
    async (event) => {
      const guesses = new Map();
      await engine.collect({
        ms: GUESS_MS,
        players: participants,
        onInput: (pid, a) => {
          if (a.kind !== 'guess' || guesses.has(pid)) return false;
          const value = Number(a.value);
          if (!Number.isFinite(value)) return false;
          guesses.set(pid, Math.min(q.max, Math.max(q.min, value)));
          event.done.push(pid);
          engine.eventPrivate.set(pid, { guess: guesses.get(pid) });
          return true;
        },
        isComplete: () => guesses.size >= participants.length,
      });

      const ranked = [...guesses].sort((x, y) => Math.abs(x[1] - q.answer) - Math.abs(y[1] - q.answer));
      const results = participants.map((p) => {
        const guess = guesses.get(p.id);
        const rank = ranked.findIndex(([id]) => id === p.id);
        let delta = 0;
        if (rank === 0) {
          const exact = Math.abs(guess - q.answer) < q.step / 2;
          delta = engine.award(p, exact ? 150 : 100, { reason: 'Il Prezzo è Giusto', boostable: true });
        } else if (rank === 1) {
          delta = engine.award(p, 50, { reason: 'Il Prezzo è Giusto', boostable: true });
        }
        return { playerId: p.id, guess: guess ?? null, diff: guess === undefined ? null : Math.abs(guess - q.answer), rank: rank >= 0 ? rank + 1 : null, delta };
      });
      const best = ranked[0] && engine.state.getPlayer(ranked[0][0]);
      engine.line(`📏 Risposta: ${q.answer}${q.unit ? ` ${q.unit}` : ''}${best ? ` — il più vicino è ${best.name}` : ''}`, 'bonus');
      Object.assign(event, { stage: 'reveal', answer: q.answer, note: q.note ?? null, results });
      engine.changed();
      await engine.sleep(REVEAL_MS);
    },
  );
}

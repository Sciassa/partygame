import { CATEGORIES, CATEGORY_IDS, checkOpenAnswer, toChoiceRound } from '../../../data/questions/index.ts';
import { cleanText, withEvent } from './common.js';

export const TRIVIA_MS = 20000;
export const DUEL_MS = 15000;
const REVEAL_MS = 5500;

/**
 * TRIVIA per tutti, in modalità TRIVIA_CHOICE (4 opzioni) o TRIVIA_OPEN (risposta da scrivere).
 * Risposta giusta: 30 Tappi + fino a 30 di bonus velocità. Chi è di turno e sbaglia (o non
 * risponde) perde 20 Tappi. I tempi delle risposte giuste alimentano il premio «Fulmine del Pub».
 */
export async function runTrivia(engine, { lander, category = null }) {
  const participants = engine.connected();
  const wanted = category ?? engine.pick(CATEGORY_IDS);
  const q = engine.questions.draw({ categories: [wanted] }) ?? engine.questions.draw();
  const mode = engine.rng() < 0.5 ? 'TRIVIA_CHOICE' : 'TRIVIA_OPEN';
  const round = mode === 'TRIVIA_CHOICE' ? toChoiceRound(q, engine.rng) : null;

  await withEvent(
    engine,
    {
      kind: 'trivia',
      mode,
      category: q.category,
      categoryLabel: CATEGORIES[q.category].label,
      question: q.question,
      options: round?.options ?? null,
      stage: 'question',
      answered: [],
      landerId: lander.id,
    },
    async (event) => {
      const answers = new Map();
      const t0 = engine.now();
      await engine.collect({
        ms: TRIVIA_MS,
        players: participants,
        onInput: (pid, a) => {
          if (a.kind !== 'answer' || answers.has(pid)) return false;
          let correct;
          let given;
          if (round) {
            const i = Number(a.choice);
            if (!(i >= 0 && i < 4)) return false;
            correct = i === round.correctIndex;
            given = round.options[i];
          } else {
            given = cleanText(a.text, 60);
            if (!given) return false;
            correct = checkOpenAnswer(q, given).correct;
          }
          answers.set(pid, { correct, given, timeMs: engine.now() - t0 });
          event.answered.push(pid);
          engine.eventPrivate.set(pid, { answered: true, given });
          return true;
        },
        isComplete: () => answers.size >= participants.length,
      });

      const results = [];
      for (const p of participants) {
        const a = answers.get(p.id);
        let delta = 0;
        if (a?.correct) {
          const limit = TRIVIA_MS * (engine.sabotageFlags(p.id).halfTime ? 0.5 : 1);
          const speed = Math.max(0, 1 - a.timeMs / limit);
          delta = engine.award(p, 30 + Math.round(30 * speed), { reason: 'Trivia', boostable: true });
          p.stats.triviaCorrect += 1;
          p.stats.triviaTimeMs += a.timeMs;
        } else if (p.id === lander.id) {
          delta = engine.award(p, -20, { reason: 'Trivia sbagliato' });
        }
        results.push({ playerId: p.id, correct: Boolean(a?.correct), given: a?.given ?? null, timeMs: a ? Math.round(a.timeMs) : null, delta });
      }
      Object.assign(event, { stage: 'reveal', answer: q.answer, correctIndex: round?.correctIndex ?? null, note: q.note ?? null, results });
      const right = results.filter((r) => r.correct).length;
      engine.line(`❓ Trivia (${CATEGORIES[q.category].label}): ${right} su ${participants.length} rispondono giusto — «${q.answer}»`, right ? 'bonus' : 'info');
      engine.changed();
      await engine.sleep(REVEAL_MS);
    },
  );
}

/**
 * SFIDA 1v1 (adesivo n.16): domanda a scelta multipla solo per i due sfidanti.
 * Chi risponde giusto per primo prende la posta dall'altro; se nessuno indovina, niente scambio.
 */
export async function runDuel(engine, { a, b, stake }) {
  const q = engine.questions.draw();
  const round = toChoiceRound(q, engine.rng);
  const players = [a, b].filter((p) => p.connected);
  await withEvent(
    engine,
    {
      kind: 'duel',
      mode: 'TRIVIA_CHOICE',
      duelists: [a.id, b.id],
      stake,
      category: q.category,
      categoryLabel: CATEGORIES[q.category].label,
      question: q.question,
      options: round.options,
      stage: 'question',
      answered: [],
    },
    async (event) => {
      let winner = null;
      const tried = new Set();
      await engine.collect({
        ms: DUEL_MS,
        players,
        onInput: (pid, act) => {
          if (act.kind !== 'answer' || tried.has(pid) || winner) return false;
          tried.add(pid);
          event.answered.push(pid);
          const correct = Number(act.choice) === round.correctIndex;
          engine.eventPrivate.set(pid, { answered: true, given: round.options[Number(act.choice)] ?? null, correct });
          if (correct) winner = engine.state.getPlayer(pid);
          return true;
        },
        isComplete: () => Boolean(winner) || tried.size >= players.length,
      });
      let transferred = 0;
      if (winner) {
        const loser = winner.id === a.id ? b : a;
        transferred = -engine.award(loser, -stake, { reason: 'Sfida 1v1', raw: true });
        engine.award(winner, transferred, { reason: 'Sfida 1v1', raw: true });
        engine.line(`⚔️ ${winner.name} vince la Sfida e prende ${transferred} Tappi a ${loser.name}`, 'gold');
      } else {
        engine.line('⚔️ Sfida: nessuno indovina, Tappi salvi', 'info');
      }
      Object.assign(event, { stage: 'reveal', answer: q.answer, correctIndex: round.correctIndex, winnerId: winner?.id ?? null, transferred });
      engine.changed();
      await engine.sleep(REVEAL_MS);
    },
  );
}

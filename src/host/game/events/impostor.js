import { claimBounty } from '../counter.js';
import { IMPOSTOR_WORDS } from '../../../data/impostor.ts';
import { cleanText, withEvent } from './common.js';

const CLUE_MS = 40000;
const VOTE_MS = 25000;
const REVEAL_MS = 7000;

/**
 * L'IMPOSTORE FLASH: tutti ricevono la parola segreta tranne l'impostore (vede solo il tema).
 * 1) ognuno scrive un indizio  2) gli indizi compaiono su TV e telefoni  3) si vota.
 * Impostore scoperto (il più votato, senza pareggi): +40 a chi l'ha votato, -30 a lui.
 * Impostore salvo: +120 per lui.
 */
export async function runImpostor(engine, { lander }) {
  const participants = engine.connected();
  const fresh = IMPOSTOR_WORDS.filter((w) => !engine.usedWords.has(w.word));
  const secret = engine.pick(fresh.length ? fresh : IMPOSTOR_WORDS);
  engine.usedWords.add(secret.word);
  const impostor = engine.pick(participants);

  await withEvent(engine, { kind: 'impostor', theme: secret.theme, stage: 'clue', submitted: [], clues: null, voted: [], landerId: lander.id }, async (event) => {
    for (const p of participants) {
      engine.eventPrivate.set(p.id, p.id === impostor.id ? { role: 'impostor', theme: secret.theme } : { role: 'crew', theme: secret.theme, word: secret.word });
    }

    const clues = new Map();
    await engine.collect({
      ms: CLUE_MS,
      players: participants,
      onInput: (pid, a) => {
        if (a.kind !== 'clue' || clues.has(pid)) return false;
        const text = cleanText(a.text, 24);
        if (!text) return false;
        clues.set(pid, text);
        event.submitted.push(pid);
        return true;
      },
      isComplete: () => clues.size >= participants.length,
    });

    event.stage = 'vote';
    event.clues = participants.map((p) => ({ playerId: p.id, text: clues.get(p.id) ?? '…' }));
    const votes = new Map();
    await engine.collect({
      ms: VOTE_MS,
      players: participants,
      onInput: (pid, a) => {
        if (a.kind !== 'vote' || votes.has(pid) || a.target === pid || !participants.some((p) => p.id === a.target)) return false;
        votes.set(pid, a.target);
        event.voted.push(pid);
        return true;
      },
      isComplete: () => votes.size >= participants.length,
    });

    const tally = {};
    for (const target of votes.values()) tally[target] = (tally[target] ?? 0) + 1;
    const impostorVotes = tally[impostor.id] ?? 0;
    const caught = impostorVotes > 0 && Object.entries(tally).every(([id, n]) => id === impostor.id || n < impostorVotes);

    const results = [];
    if (caught) {
      for (const [voter, target] of votes) {
        if (target !== impostor.id) continue;
        const p = engine.state.getPlayer(voter);
        results.push({ playerId: voter, delta: engine.award(p, 40, { reason: 'Impostore', boostable: true }) });
      }
      results.push({ playerId: impostor.id, delta: engine.award(impostor, -30, { reason: 'Impostore scoperto' }) });
      // Taglia: il primo che ha smascherato l'impostore (facendogli perdere Tappi) la riscuote
      const firstVoter = [...votes].find(([, target]) => target === impostor.id);
      if (firstVoter) claimBounty(engine, impostor, engine.state.getPlayer(firstVoter[0]), "l'ha smascherato");
      engine.line(`🕵️ Impostore scoperto: era ${impostor.name}! La parola era «${secret.word}»`, 'bonus');
    } else {
      results.push({ playerId: impostor.id, delta: engine.award(impostor, 120, { reason: 'Impostore', boostable: true }) });
      engine.line(`🕵️ ${impostor.name} l'ha fatta franca da impostore! La parola era «${secret.word}»`, 'gold');
    }
    Object.assign(event, { stage: 'reveal', impostorId: impostor.id, word: secret.word, caught, tally, votes: [...votes], results });
    engine.changed();
    await engine.sleep(REVEAL_MS);
  });
}

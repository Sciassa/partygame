import { PHASE } from '../protocol.js';

/**
 * Helper di presentazione condivisi da schermo TV e telefoni (nessuna regola di gioco qui).
 */

/** Dopo quanti ms dall'inizio dello spin i rulli del Top Slot si fermano e svelano l'estrazione. */
export function topSlotRevealMs(plan) {
  if (!plan || plan.kind === 'ease') return 0;
  return Math.min(2600, plan.duration * 0.45);
}

/** Etichetta breve della fase per banner e telefoni. */
export function phaseLabel(s, name = (id) => id) {
  const who = s.turnPlayerId ? name(s.turnPlayerId) : '';
  switch (s.phase) {
    case PHASE.LOBBY:
      return 'In attesa dei giocatori';
    case PHASE.SHOP:
      return `${who} è al Negozio Adesivi`;
    case PHASE.BETTING:
      return 'Scommesse aperte!';
    case PHASE.AWAIT_SPIN:
      return `Tocca a ${who}: lancia la ruota`;
    case PHASE.SPINNING:
      return 'La ruota gira...';
    case PHASE.LANDING:
      return 'Risoluzione dello spicchio';
    case PHASE.CHOICE:
      return `${s.choice ? name(s.choice.playerId) : who} deve scegliere`;
    case PHASE.EVENT:
      return eventTitle(s.event);
    case PHASE.TURN_RESULT:
      return 'Fine turno';
    case PHASE.AWARDS:
      return 'Bonus Segreti';
    case PHASE.GAME_OVER:
      return 'Partita finita!';
    default:
      return '';
  }
}

export function eventTitle(event) {
  switch (event?.kind) {
    case 'trivia':
      return event.mode === 'TRIVIA_OPEN' ? `Trivia a risposta aperta · ${event.categoryLabel}` : `Trivia · ${event.categoryLabel}`;
    case 'duel':
      return `Sfida 1v1 · ${event.categoryLabel}`;
    case 'impostor':
      return "L'Impostore Flash";
    case 'pour':
      return 'La Spillatura Perfetta';
    case 'auction':
      return 'Asta al Buio';
    case 'price':
      return 'Higher / Lower';
    case 'fortune':
      return 'Fortuna';
    default:
      return '';
  }
}

/** Numero con segno, per i delta di Tappi. */
export function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

/** Valore numerico leggibile all'italiana (1.234,5). */
export function formatNumber(n, step = 1) {
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Sabotaggio «Dislessia»: mescola le lettere interne di ogni parola, in modo stabile
 * (stesso testo → stessa versione mescolata, così non "balla" a ogni aggiornamento).
 */
export function scramble(text) {
  let seed = [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  return text
    .split(' ')
    .map((word) => {
      if (word.length < 4) return [...word].reverse().join('');
      const inner = [...word.slice(1, -1)];
      for (let i = inner.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [inner[i], inner[j]] = [inner[j], inner[i]];
      }
      return word[0] + inner.join('') + word[word.length - 1];
    })
    .join(' ');
}

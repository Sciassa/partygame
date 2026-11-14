import { PHASE } from '../../../shared/protocol.js';

/**
 * Cornice comune a ogni evento sui telefoni: fase EVENT, sabotaggi in coda che diventano attivi,
 * pulizia finale (anche se la partita viene interrotta).
 */
export async function withEvent(engine, data, body) {
  engine.phase = PHASE.EVENT;
  engine.event = data;
  engine.beginEventSabotage();
  engine.changed();
  try {
    await body(data);
  } finally {
    engine.endEventSabotage();
    engine.eventPrivate.clear();
    engine.event = null;
    engine.changed();
  }
}

/** Premi per posizione (1°, 2°, 3°...). */
export function prizeFor(rank, prizes) {
  return prizes[rank] ?? 0;
}

/** Testo libero breve e pulito (indizi, risposte aperte). */
export function cleanText(text, max = 40) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

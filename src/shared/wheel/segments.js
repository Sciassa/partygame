/**
 * Spicchi della Ruota.
 *
 * Uno spicchio sulla ruota è:
 *   { id, type, size, sticker, jackpot }
 *  - size:    ampiezza relativa (1 normale; l'adesivo «Espansione» la porta a 2 o 3)
 *  - sticker: null oppure { id, ownerId, ownerColor, level (1|2), lockedTurns, placedTurn }
 *  - jackpot: montepremi accumulato dall'adesivo «Jackpot»
 */
export const SEGMENT_TYPE = Object.freeze({
  TRIVIA: 'trivia',
  MINIGAME: 'minigame',
  FORTUNE: 'fortune',
  KEG: 'keg', // «Fusto d'Oro»: si possono convertire Tappi in Pinte d'Oro
});

/**
 * Aspetto e testi di ogni tipo di spicchio. Come nella reference: spicchi blu notte quasi neri,
 * appena tinti per tipo, con decori e scritte in oro; il colore vivo (glow) è per luci e UI.
 */
export const SEGMENT_INFO = Object.freeze({
  [SEGMENT_TYPE.TRIVIA]: { label: 'TRIVIA', emoji: '❓', icon: 'question', color: '#152a33', glow: '#46c9c9', description: 'Domanda per tutti: risposte giuste e veloci valgono Tappi.' },
  [SEGMENT_TYPE.MINIGAME]: { label: 'MINIGIOCO', emoji: '⚡', icon: 'bolt', color: '#2c1823', glow: '#ff7a8f', description: 'Sfida lampo sui telefoni.' },
  [SEGMENT_TYPE.FORTUNE]: { label: 'FORTUNA', emoji: '🪙', icon: 'coin', color: '#2e2414', glow: '#ffb547', description: 'Tappi in regalo... o forse no.' },
  [SEGMENT_TYPE.KEG]: { label: "FUSTO D'ORO", emoji: '🍺', icon: 'keg', color: '#3a2a0c', glow: '#ffd27a', description: 'Converti Tappi in una Pinta d\'Oro.' },
});

const BASE_LAYOUT = [
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.KEG,
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
];

export function createBaseSegments() {
  return BASE_LAYOUT.map((type, i) => ({ id: `s${i}`, type, size: 1, sticker: null, jackpot: 0 }));
}

export function segmentInfo(segment) {
  return SEGMENT_INFO[segment?.type] ?? { label: '???', emoji: '❔', icon: 'question', color: '#555555', glow: '#ffffff', description: '' };
}

/** Nome leggibile di uno spicchio, con numero (1-based) per distinguerli nel negozio. */
export function segmentName(segment, index) {
  return `${segmentInfo(segment).label} #${index + 1}`;
}

/**
 * Definizione degli spicchi della Ruota.
 * Uno spicchio "istanza" sulla ruota è { id, type, stickers: [] }: gli adesivi comprati nel negozio
 * verranno aggiunti in `stickers` (trappole, scudi, moltiplicatori...) e modificheranno la risoluzione.
 */
export const SEGMENT_TYPE = Object.freeze({
  TRIVIA: 'trivia',
  MINIGAME: 'minigame',
  FORTUNE: 'fortune',
});

/** Aspetto e testi di ogni tipo di spicchio (colori neon pop). */
export const SEGMENT_INFO = Object.freeze({
  [SEGMENT_TYPE.TRIVIA]: { label: 'TRIVIA', emoji: '❓', color: '#00e5ff', description: 'Domanda a risposta multipla per tutti!' },
  [SEGMENT_TYPE.MINIGAME]: { label: 'MINIGIOCO', emoji: '🎮', color: '#ff2bd6', description: 'Sfida lampo sui telefoni!' },
  [SEGMENT_TYPE.FORTUNE]: { label: 'FORTUNA', emoji: '🍀', color: '#ffd400', description: 'Monete in regalo... o forse no.' },
});

const BASE_LAYOUT = [
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
  SEGMENT_TYPE.TRIVIA,
  SEGMENT_TYPE.MINIGAME,
  SEGMENT_TYPE.FORTUNE,
];

export function createBaseSegments() {
  return BASE_LAYOUT.map((type, i) => ({ id: `s${i}`, type, stickers: [] }));
}

export function segmentInfo(segment) {
  return SEGMENT_INFO[segment.type] ?? { label: '???', emoji: '❔', color: '#ffffff', description: '' };
}

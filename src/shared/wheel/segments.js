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

/**
 * Aspetto e testi di ogni tipo di spicchio. Come nella reference: spicchi blu notte quasi neri,
 * appena tinti per tipo, con decori e scritte in oro; il colore vivo (glow) è per luci e UI.
 *  - color: colore (scuro) dello spicchio sulla ruota
 *  - glow:  versione più luminosa per luci, testi e UI
 *  - icon:  icona vettoriale disegnata sulla texture (vedi wheelTexture.js)
 */
export const SEGMENT_INFO = Object.freeze({
  [SEGMENT_TYPE.TRIVIA]: { label: 'TRIVIA', emoji: '❓', icon: 'question', color: '#152a33', glow: '#46c9c9', description: 'Domanda a risposta multipla per tutti!' },
  [SEGMENT_TYPE.MINIGAME]: { label: 'MINIGIOCO', emoji: '⚡', icon: 'bolt', color: '#2c1823', glow: '#ff7a8f', description: 'Sfida lampo sui telefoni!' },
  [SEGMENT_TYPE.FORTUNE]: { label: 'FORTUNA', emoji: '🪙', icon: 'coin', color: '#2e2414', glow: '#ffb547', description: 'Monete in regalo... o forse no.' },
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
  return SEGMENT_INFO[segment.type] ?? { label: '???', emoji: '❔', icon: 'question', color: '#555555', glow: '#ffffff', description: '' };
}

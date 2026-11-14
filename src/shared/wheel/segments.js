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
 * Aspetto e testi di ogni tipo di spicchio. Palette "pub": toni gioiello saturi ma profondi,
 * che staccano sul fondo blu notte senza sembrare un giocattolo.
 *  - color: colore dello spicchio sulla ruota
 *  - glow:  versione più luminosa per luci, testi e UI
 *  - icon:  icona vettoriale disegnata sulla texture (vedi wheelTexture.js)
 */
export const SEGMENT_INFO = Object.freeze({
  [SEGMENT_TYPE.TRIVIA]: { label: 'TRIVIA', emoji: '❓', icon: 'question', color: '#1f7f86', glow: '#3fd0d4', description: 'Domanda a risposta multipla per tutti!' },
  [SEGMENT_TYPE.MINIGAME]: { label: 'MINIGIOCO', emoji: '⚡', icon: 'bolt', color: '#9e2742', glow: '#ff5a7e', description: 'Sfida lampo sui telefoni!' },
  [SEGMENT_TYPE.FORTUNE]: { label: 'FORTUNA', emoji: '🪙', icon: 'coin', color: '#c98a1e', glow: '#ffc251', description: 'Monete in regalo... o forse no.' },
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

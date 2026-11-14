/**
 * Catalogo dei 30 adesivi della Ruota Evolutiva.
 *
 * Regole generali (applicate dall'host in src/host/game/stickerEngine.js):
 *  - si compra nel Negozio (3 adesivi casuali per turno) e si incolla su uno spicchio
 *  - lo spicchio prende il bordo del colore della birra del proprietario
 *  - ROYALTIES: ogni volta che un ALTRO giocatore ci capita, il proprietario incassa 15 Tappi (30 al Lv.2)
 *  - incollarlo su un proprio spicchio lo porta al Lv.2: effetto raddoppiato (vedi `level2`)
 *  - sovrascrivere l'adesivo di un altro costa +50%; uno spicchio con il Lucchetto non si tocca
 *  - i SABOTAGGI colpiscono tutti tranne il proprietario, nel primo evento sui telefoni (trivia/minigioco)
 *
 * `trigger`:
 *  - 'land'    effetto quando qualcuno si ferma sullo spicchio
 *  - 'place'   effetto immediato quando lo si incolla (Rovina, Lucchetto, Espansione)
 *  - 'passive' modifica permanente finché resta sulla ruota (Calamita, Jackpot)
 *  - 'sabotage' modificatore sull'interfaccia dei telefoni nel prossimo evento
 * `polarity` (per chi ci capita): serve a Scudo, Specchio e al premio «Bersaglio Umano».
 */

export type StickerCategory = 'economia' | 'strategia' | 'ruota' | 'sabotaggio';
export type StickerTrigger = 'land' | 'place' | 'passive' | 'sabotage';
export type StickerPolarity = 'bonus' | 'malus' | 'neutral';

export interface Sticker {
  id: string;
  number: number;
  name: string;
  category: StickerCategory;
  icon: string;
  cost: number;
  trigger: StickerTrigger;
  polarity: StickerPolarity;
  description: string;
  level2: string;
}

export const STICKER_CATEGORIES: Readonly<Record<StickerCategory, { label: string; color: string }>> = {
  economia: { label: 'Economia', color: '#ffb547' },
  strategia: { label: 'Posizione e strategia', color: '#46c9c9' },
  ruota: { label: 'Manipolazione ruota', color: '#b48cff' },
  sabotaggio: { label: 'Sabotaggi', color: '#ff7a8f' },
};

export const STICKERS: readonly Sticker[] = [
  // ---------------------------------------------------------------- ECONOMIA
  { id: 'tassa', number: 1, name: 'Tassa di Passaggio', category: 'economia', icon: '💸', cost: 60, trigger: 'land', polarity: 'malus', description: 'Chi ci capita paga 50 Tappi al proprietario.', level2: 'Paga 100 Tappi.' },
  { id: 'robin', number: 2, name: 'Robin Hood', category: 'economia', icon: '🏹', cost: 70, trigger: 'land', polarity: 'neutral', description: 'Il primo in classifica perde il 20% dei Tappi, divisi tra tutti gli altri.', level2: 'Perde il 40%.' },
  { id: 'bancarotta', number: 3, name: 'Bancarotta', category: 'economia', icon: '📉', cost: 90, trigger: 'land', polarity: 'malus', description: 'Chi ci capita perde metà dei suoi Tappi.', level2: 'Perde il 75%.' },
  { id: 'jackpot', number: 4, name: 'Jackpot', category: 'economia', icon: '🎰', cost: 80, trigger: 'passive', polarity: 'bonus', description: 'Accumula il 10% di tutto ciò che si spende (negozio, scommesse, Fusto). Chi ci capita vince il montepremi.', level2: 'Accumula il 20%.' },
  { id: 'boost', number: 5, name: 'Boost x2', category: 'economia', icon: '⚡', cost: 50, trigger: 'land', polarity: 'bonus', description: 'Chi ci capita raddoppia tutti i Tappi che vince in questo turno.', level2: 'Li triplica.' },
  { id: 'sanguisuga', number: 6, name: 'Sanguisuga', category: 'economia', icon: '🩸', cost: 80, trigger: 'land', polarity: 'bonus', description: 'Chi ci capita ruba 15 Tappi a ogni altro giocatore.', level2: 'Ne ruba 30 a testa.' },
  { id: 'cashback', number: 7, name: 'Cashback', category: 'economia', icon: '🔁', cost: 50, trigger: 'land', polarity: 'bonus', description: 'Chi ci capita riceve il 25% di tutti i Tappi spesi finora in partita (max 150).', level2: '50%, max 300.' },
  { id: 'comunismo', number: 8, name: 'Comunismo', category: 'economia', icon: '☭', cost: 100, trigger: 'land', polarity: 'neutral', description: 'I Tappi di tutti vengono ridistribuiti in parti uguali.', level2: 'In più il proprietario incassa 50 Tappi.' },
  { id: 'dividendo', number: 9, name: 'Dividendo', category: 'economia', icon: '📈', cost: 70, trigger: 'land', polarity: 'bonus', description: 'Tutti ricevono 20 Tappi, il proprietario 60 in più.', level2: '40 a tutti, 120 al proprietario.' },

  // ---------------------------------------------------------------- POSIZIONE / STRATEGIA
  { id: 'scambio', number: 10, name: "Scambio con l'Ultimo", category: 'strategia', icon: '🔄', cost: 80, trigger: 'land', polarity: 'neutral', description: "Chi ci capita scambia i suoi Tappi con l'ultimo in classifica.", level2: 'Lo scambio avviene con il primo.' },
  { id: 'sorpasso', number: 11, name: 'Il Sorpasso', category: 'strategia', icon: '🏎️', cost: 70, trigger: 'land', polarity: 'bonus', description: 'Chi ci capita scambia i Tappi con chi gli sta subito davanti in classifica.', level2: 'Con chi sta due posizioni davanti.' },
  { id: 'calamita', number: 12, name: 'Calamita', category: 'strategia', icon: '🧲', cost: 90, trigger: 'passive', polarity: 'neutral', description: 'Se la ruota si ferma su uno spicchio vicino, c\'è il 40% di probabilità che scivoli qui.', level2: '80% di probabilità.' },
  { id: 'scudo', number: 13, name: 'Scudo di Titanio', category: 'strategia', icon: '🛡️', cost: 60, trigger: 'land', polarity: 'bonus', description: 'Chi ci capita è immune a malus e trappole per 2 turni.', level2: 'Per 4 turni.' },
  { id: 'ancora', number: 14, name: "L'Ancora", category: 'strategia', icon: '⚓', cost: 70, trigger: 'land', polarity: 'malus', description: 'Chi ci capita non guadagna Tappi per 1 turno (questo compreso).', level2: 'Per 2 turni.' },
  { id: 'voto_segreto', number: 15, name: 'Voto Segreto', category: 'strategia', icon: '🙈', cost: 50, trigger: 'land', polarity: 'neutral', description: 'La classifica viene nascosta a tutti per 3 turni.', level2: 'Per 6 turni.' },
  { id: 'sfida', number: 16, name: 'Sfida 1v1', category: 'strategia', icon: '⚔️', cost: 70, trigger: 'land', polarity: 'neutral', description: 'Chi ci capita sceglie un rivale: trivia secco, chi risponde giusto per primo prende 100 Tappi dall\'altro.', level2: 'In palio 200 Tappi.' },

  // ---------------------------------------------------------------- MANIPOLAZIONE RUOTA
  { id: 'espansione', number: 17, name: 'Espansione', category: 'ruota', icon: '↔️', cost: 90, trigger: 'place', polarity: 'neutral', description: "Lo spicchio raddoppia la sua ampiezza sulla ruota.", level2: 'La triplica.' },
  { id: 'buco_nero', number: 18, name: 'Buco Nero', category: 'ruota', icon: '🕳️', cost: 60, trigger: 'land', polarity: 'malus', description: 'Chi ci capita salta il suo prossimo turno.', level2: 'Salta i prossimi 2 turni.' },
  { id: 'specchio', number: 19, name: 'Specchio Riflesso', category: 'ruota', icon: '🪞', cost: 60, trigger: 'land', polarity: 'bonus', description: 'Chi ci capita rimanda il prossimo malus al proprietario dell\'adesivo che lo colpisce (vale 3 turni).', level2: 'Vale 6 turni.' },
  { id: 'lucchetto', number: 20, name: 'Lucchetto', category: 'ruota', icon: '🔒', cost: 40, trigger: 'place', polarity: 'neutral', description: 'Lo spicchio non può essere sovrascritto né rovinato per 5 turni.', level2: 'Per 10 turni.' },
  { id: 'rovina', number: 21, name: 'Rovina', category: 'ruota', icon: '🧨', cost: 50, trigger: 'place', polarity: 'neutral', description: "Cancella l'adesivo presente sullo spicchio scelto (si consuma subito).", level2: 'Non si può potenziare: si consuma subito.' },
  { id: 'roulette', number: 22, name: 'Roulette Russa', category: 'ruota', icon: '🎲', cost: 60, trigger: 'land', polarity: 'neutral', description: 'Chi ci capita: 50% raddoppia i Tappi (max +150), 50% li dimezza.', level2: 'Max +300 se va bene.' },
  { id: 'copia', number: 23, name: 'Copia-Incolla', category: 'ruota', icon: '📋', cost: 60, trigger: 'land', polarity: 'neutral', description: "Ripete l'effetto dell'ultimo adesivo attivato in partita.", level2: 'Lo ripete due volte.' },

  // ---------------------------------------------------------------- SABOTAGGI (UI dei telefoni)
  { id: 'dittatura', number: 24, name: 'Dittatura', category: 'sabotaggio', icon: '👑', cost: 60, trigger: 'sabotage', polarity: 'neutral', description: 'Il proprietario sceglie la categoria del prossimo Trivia.', level2: 'Sceglie le categorie dei prossimi 2 Trivia.' },
  { id: 'blackout', number: 25, name: 'Blackout', category: 'sabotaggio', icon: '🌑', cost: 50, trigger: 'sabotage', polarity: 'malus', description: 'Nel prossimo evento i telefoni degli altri diventano in bianco e nero.', level2: 'Per 2 eventi.' },
  { id: 'dito_tremante', number: 26, name: 'Dito Tremante', category: 'sabotaggio', icon: '🫨', cost: 60, trigger: 'sabotage', polarity: 'malus', description: 'Nel prossimo evento i bottoni degli altri tremano e si spostano.', level2: 'Per 2 eventi.' },
  { id: 'fuso_orario', number: 27, name: 'Fuso Orario', category: 'sabotaggio', icon: '⏱️', cost: 70, trigger: 'sabotage', polarity: 'malus', description: 'Nel prossimo evento gli altri hanno metà del tempo.', level2: 'Per 2 eventi.' },
  { id: 'sabotaggio', number: 28, name: 'Sabotaggio', category: 'sabotaggio', icon: '🐌', cost: 50, trigger: 'sabotage', polarity: 'malus', description: 'Nel prossimo evento il primo in classifica ha 1 secondo di ritardo su ogni tocco.', level2: 'Per 2 eventi.' },
  { id: 'dislessia', number: 29, name: 'Dislessia', category: 'sabotaggio', icon: '🔀', cost: 60, trigger: 'sabotage', polarity: 'malus', description: 'Nel prossimo evento gli altri vedono le lettere delle opzioni mescolate.', level2: 'Per 2 eventi.' },
  { id: 'rewind', number: 30, name: 'Rewind', category: 'sabotaggio', icon: '⏪', cost: 60, trigger: 'land', polarity: 'neutral', description: "Chi ci capita torna ai Tappi che aveva all'inizio del turno precedente.", level2: 'A quelli di due turni fa.' },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export function getSticker(id: string): Sticker | undefined {
  return BY_ID.get(id);
}

/** Royalties per il proprietario quando un altro giocatore ci capita. */
export const ROYALTIES = 15;
/** Sovrapprezzo per sovrascrivere l'adesivo di un altro giocatore. */
export const OVERWRITE_SURCHARGE = 0.5;
/** Quanti adesivi propone il Negozio a ogni visita. */
export const SHOP_OFFER_SIZE = 3;

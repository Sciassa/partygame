/**
 * «🍻 Bancone & Sottobanco»: regole condivise (host per validare, telefoni per mostrare prezzi).
 *
 * Il Bancone è aperto a inizio turno (Negozio, Scommesse, attesa del lancio):
 *  - 🎯 TAGLIA: paghi 40 Tappi e metti una taglia su un avversario per 2 turni. Chi lo batte
 *    (Sfida 1v1, Asta al Buio) o gli fa perdere Tappi (un suo adesivo, smascherarlo da Impostore)
 *    incassa 60 Tappi dalla banca.
 *  - 🤫 SOTTOBANCO: passi 20 o 50 Tappi a un amico. Tutti vedono solo «Movimento sospetto al bancone!».
 *  - 🥃 SHOT (uno alla volta nell'inventario), da usare nel PROPRIO turno prima di lanciare:
 *      Assenzio (60):         il prossimo lancio ignora le trappole nemiche e non paga royalties
 *      Tequila Bum Bum (50):  il prossimo evento ti rende x2.5; se non guadagni nulla, -50
 *      Birra Analcolica (45): la lanci addosso a un avversario: è fradicio (grigio) e al suo prossimo
 *                             Trivia le risposte sono coperte di schiuma (2 tocchi per scoppiarla)
 */
export const COUNTER = Object.freeze({
  bounty: { cost: 40, reward: 60, turns: 2 },
  slipAmounts: Object.freeze([20, 50]),
  shots: Object.freeze({
    assenzio: { id: 'assenzio', name: 'Assenzio', icon: '🧪', price: 60, target: false, description: 'Il prossimo lancio ignora le trappole nemiche e non paga royalties.' },
    tequila: { id: 'tequila', name: 'Tequila Bum Bum', icon: '🍋', price: 50, target: false, description: 'Il prossimo evento ti rende x2.5. Se non guadagni nulla: -50 Tappi.' },
    analcolica: { id: 'analcolica', name: 'Birra Analcolica', icon: '🫗', price: 45, target: true, description: "Lanciala su un avversario: al suo prossimo Trivia le risposte sono coperte di schiuma." },
  }),
});

export const SHOT_IDS = Object.freeze(Object.keys(COUNTER.shots));

/** Emote dal telefono: cooldown condiviso da client e host. */
export const EMOTE_COOLDOWN_MS = 2500;
export const EMOTE_IDS = Object.freeze(['cheers', 'laugh', 'boo', 'fire']);

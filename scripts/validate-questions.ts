/**
 * Controllo di qualità del database Trivia.   pnpm validate:questions
 *
 * Verifica, per ogni domanda:
 *  - id e testo univoci, 3 distrattori diversi tra loro e dalla risposta
 *  - la risposta aperta accetta tutte le `acceptedAnswers` (anche senza accenti/maiuscole)
 *  - la risposta aperta NON accetta nessun distrattore (il fuzzy non deve essere troppo largo)
 *  - almeno 40 domande per categoria
 * Esce con codice 1 se trova errori.
 */
declare const process: { exit(code: number): never }; // script Node: evitiamo @types/node solo per questo

import { ALL_QUESTIONS, CATEGORY_IDS, QUESTIONS_BY_CATEGORY, checkOpenAnswer, getQuestionById, getUsedQuestionsTracker, normalizeAnswer, toChoiceRound } from '../src/data/questions/index.ts';

const errors: string[] = [];
const warn = (id: string, msg: string) => errors.push(`${id}: ${msg}`);

const ids = new Set<string>();
const texts = new Set<string>();
for (const q of ALL_QUESTIONS) {
  if (ids.has(q.id)) warn(q.id, 'id duplicato');
  ids.add(q.id);
  const text = normalizeAnswer(q.question);
  if (texts.has(text)) warn(q.id, 'testo duplicato');
  texts.add(text);

  if (!q.question.trim().endsWith('?')) warn(q.id, 'la domanda non termina con "?"');
  const options = [q.answer, ...q.wrongAnswers].map(normalizeAnswer);
  if (new Set(options).size !== 4) warn(q.id, `opzioni non distinte: ${[q.answer, ...q.wrongAnswers].join(' | ')}`);

  for (const accepted of q.acceptedAnswers) {
    for (const variant of [accepted, accepted.toUpperCase(), accepted.normalize('NFD').replace(/[̀-ͯ]/g, '')]) {
      if (!checkOpenAnswer(q, variant).correct) warn(q.id, `variante accettata rifiutata: "${variant}"`);
    }
  }
  for (const wrong of q.wrongAnswers) {
    const r = checkOpenAnswer(q, wrong);
    if (r.correct) warn(q.id, `il distrattore "${wrong}" verrebbe accettato (≈ "${r.matched}")`);
  }

  const round = toChoiceRound(q);
  if (round.options[round.correctIndex] !== q.answer) warn(q.id, 'toChoiceRound: indice corretto sbagliato');
}

for (const c of CATEGORY_IDS) {
  const n = QUESTIONS_BY_CATEGORY[c].length;
  if (n < 40) errors.push(`${c}: solo ${n} domande (minimo 40)`);
}

// il tracker non ripete finché non esaurisce il filtro
const tracker = getUsedQuestionsTracker();
const seen = new Set<string>();
for (let i = 0; i < ALL_QUESTIONS.length; i++) {
  const q = tracker.draw();
  if (!q || seen.has(q.id)) {
    errors.push(`tracker: ripetizione o esaurimento prematuro al giro ${i}`);
    break;
  }
  seen.add(q.id);
}

// casi reali di battitura: [id, input, deve essere giusta?]
const SAMPLES: [string, string, boolean][] = [
  ['sport-001', 'gotze', true],
  ['sport-001', 'GÖTZE!!', true],
  ['sport-001', 'muller', false],
  ['sport-021', 'higuian', true], // refuso
  ['geografia-001', 'canbera', true], // refuso
  ['geografia-001', 'sydney', false],
  ['storia-049', 'giorgio 3', false], // i numeri devono coincidere: la variante è «Giorgio III»
  ['storia-049', 'giorgio terzo', true],
  ['cinema_serie-001', 'grande bellezza', true],
  ['cinema_serie-027', 'roman roy', false],
  ['pop_tech-034', 'iphone 10', true],
  ['pop_tech-034', 'iphone 11', false],
  ['musica-028', 'takagi e ketra', true],
  ['arte_letteratura-023', 'trecento', true],
  ['arte_letteratura-023', 'XV', false],
];
for (const [id, input, expected] of SAMPLES) {
  const q = getQuestionById(id);
  if (!q) {
    errors.push(`campione: domanda ${id} inesistente`);
    continue;
  }
  const r = checkOpenAnswer(q, input);
  if (r.correct !== expected) errors.push(`campione ${id}: "${input}" → ${r.correct} (atteso ${expected}) [${q.answer}]`);
}

const summary = CATEGORY_IDS.map((c) => `${c}: ${QUESTIONS_BY_CATEGORY[c].length}`).join(', ');
console.log(`Domande totali: ${ALL_QUESTIONS.length} (${summary})`);
if (errors.length) {
  console.error(`\n${errors.length} problemi:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: nessun problema trovato.');

/**
 * Database Trivia: export unificato + helper per l'host.
 *
 *   import { getUsedQuestionsTracker, toChoiceRound, checkOpenAnswer } from '../data/questions/index.ts';
 *
 *   const tracker = getUsedQuestionsTracker({ rng: randomFloat }); // uno per partita
 *   const q = tracker.draw({ categories: ['sport', 'musica'] });   // mai la stessa domanda due volte
 *   const round = toChoiceRound(q, randomFloat);                   // TRIVIA_CHOICE: 4 opzioni mescolate
 *   checkOpenAnswer(q, 'gotze');                                   // TRIVIA_OPEN: { correct: true, ... }
 */
import type { Difficulty, TriviaCategory, TriviaQuestion } from './types.ts';
import { sportQuestions } from './sport.ts';
import { musicaQuestions } from './musica.ts';
import { storiaQuestions } from './storia.ts';
import { geografiaQuestions } from './geografia.ts';
import { arteLetteraturaQuestions } from './arte_letteratura.ts';
import { cinemaSerieQuestions } from './cinema_serie.ts';
import { popTechQuestions } from './pop_tech.ts';

export type { Difficulty, TriviaCategory, TriviaMode, TriviaQuestion } from './types.ts';

/** Etichette per UI e ruota (in italiano). */
export const CATEGORIES: Readonly<Record<TriviaCategory, { label: string; short: string }>> = {
  sport: { label: 'Sport', short: 'SPORT' },
  musica: { label: 'Musica', short: 'MUSICA' },
  storia: { label: 'Storia', short: 'STORIA' },
  geografia: { label: 'Geografia', short: 'GEO' },
  arte_letteratura: { label: 'Arte e Letteratura', short: 'ARTE' },
  cinema_serie: { label: 'Cinema e Serie TV', short: 'CINEMA' },
  pop_tech: { label: 'Internet, Gaming e Tech', short: 'POP' },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as TriviaCategory[];

export const QUESTIONS_BY_CATEGORY: Readonly<Record<TriviaCategory, readonly TriviaQuestion[]>> = {
  sport: sportQuestions,
  musica: musicaQuestions,
  storia: storiaQuestions,
  geografia: geografiaQuestions,
  arte_letteratura: arteLetteraturaQuestions,
  cinema_serie: cinemaSerieQuestions,
  pop_tech: popTechQuestions,
};

export const ALL_QUESTIONS: readonly TriviaQuestion[] = CATEGORY_IDS.flatMap((c) => QUESTIONS_BY_CATEGORY[c]);

const BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

export function getQuestionById(id: string): TriviaQuestion | undefined {
  return BY_ID.get(id);
}

export function getQuestionsByCategory(category: TriviaCategory): readonly TriviaQuestion[] {
  return QUESTIONS_BY_CATEGORY[category] ?? [];
}

// ---------------------------------------------------------------------------- filtri e pesca

export interface QuestionFilter {
  /** Solo queste categorie (default: tutte). */
  categories?: readonly TriviaCategory[];
  /** Solo questa difficoltà (default: tutte). */
  difficulty?: Difficulty;
}

/** Generatore 0..1. Sull'host usare il random crittografico (shared/util/random.js → randomFloat). */
export type Rng = () => number;

export function filterQuestions(filter: QuestionFilter = {}): TriviaQuestion[] {
  const categories = filter.categories?.length ? new Set(filter.categories) : null;
  return ALL_QUESTIONS.filter((q) => (!categories || categories.has(q.category)) && (!filter.difficulty || q.difficulty === filter.difficulty));
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export interface QuestionTracker {
  /** Pesca una domanda mai uscita in questa partita (null se il filtro non ne trova). */
  draw(filter?: QuestionFilter): TriviaQuestion | null;
  /** Pesca `count` domande diverse tra loro e mai uscite. */
  drawMany(count: number, filter?: QuestionFilter): TriviaQuestion[];
  /** Segna come uscita (es. ripristinando una partita salvata). */
  markUsed(id: string): void;
  isUsed(id: string): boolean;
  /** Quante domande non ancora uscite soddisfano il filtro. */
  remaining(filter?: QuestionFilter): number;
  /** Id già usciti, serializzabili (per salvare/riprendere la partita). */
  usedIds(): string[];
  reset(): void;
}

/**
 * Tracker "senza ripetizioni" per UNA partita. Va creato all'inizio di ogni partita.
 * Se un filtro esaurisce le domande disponibili e `recycleWhenExhausted` è true (default),
 * solo le domande di quel filtro tornano pescabili: le altre restano "già viste".
 */
export function getUsedQuestionsTracker({ rng = Math.random, recycleWhenExhausted = true }: { rng?: Rng; recycleWhenExhausted?: boolean } = {}): QuestionTracker {
  const used = new Set<string>();

  const available = (filter?: QuestionFilter) => filterQuestions(filter).filter((q) => !used.has(q.id));

  const tracker: QuestionTracker = {
    draw(filter) {
      let pool = available(filter);
      if (!pool.length && recycleWhenExhausted) {
        for (const q of filterQuestions(filter)) used.delete(q.id);
        pool = available(filter);
      }
      if (!pool.length) return null;
      const q = pick(pool, rng);
      used.add(q.id);
      return q;
    },
    drawMany(count, filter) {
      const out: TriviaQuestion[] = [];
      for (let i = 0; i < count; i++) {
        const q = tracker.draw(filter);
        if (!q || out.includes(q)) break;
        out.push(q);
      }
      return out;
    },
    markUsed(id) {
      if (BY_ID.has(id)) used.add(id);
    },
    isUsed: (id) => used.has(id),
    remaining: (filter) => available(filter).length,
    usedIds: () => [...used],
    reset: () => used.clear(),
  };
  return tracker;
}

/** Categoria a caso (es. per lo spicchio TRIVIA della ruota). */
export function pickRandomCategory(rng: Rng = Math.random, among: readonly TriviaCategory[] = CATEGORY_IDS): TriviaCategory {
  return pick(among, rng);
}

// ---------------------------------------------------------------------------- formati di gioco

export interface ChoiceRound {
  id: string;
  category: TriviaCategory;
  question: string;
  /** Quattro opzioni mescolate. */
  options: [string, string, string, string];
  correctIndex: number;
}

/** TRIVIA_CHOICE: risposta + 3 distrattori, mescolati (Fisher-Yates). */
export function toChoiceRound(q: TriviaQuestion, rng: Rng = Math.random): ChoiceRound {
  const options = [q.answer, ...q.wrongAnswers];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)) % (i + 1);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    options: options as ChoiceRound['options'],
    correctIndex: options.indexOf(q.answer),
  };
}

/** Versione "pubblica" per i client: niente risposta (la conosce solo l'host). */
export function toOpenRound(q: TriviaQuestion): { id: string; category: TriviaCategory; question: string } {
  return { id: q.id, category: q.category, question: q.question };
}

// ---------------------------------------------------------------------------- risposta aperta (fuzzy)

const ARTICLES = /^(il|lo|la|i|gli|le|l|un|uno|una|the|el|los|las|der|die|das)\s+/;

/**
 * Normalizza per il confronto: minuscole, niente accenti, niente punteggiatura/apostrofi,
 * "&" → "e", spazi compattati, articolo iniziale rimosso ("La grande bellezza" ≈ "grande bellezza").
 */
export function normalizeAnswer(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' e ')
    .replace(/[\u2018\u2019'`´"«»\u201C\u201D.,;:!?¿¡()[\]{}\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ARTICLES, '');
}

/** Distanza di Levenshtein con uscita anticipata oltre `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Errori di battitura tollerati in base alla lunghezza della risposta. Numeri: esatti. */
function tolerance(target: string): number {
  if (/^[\d\s]+$/.test(target)) return 0;
  const len = target.replace(/\s/g, '').length;
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 12) return 2;
  return 3;
}

export interface OpenAnswerResult {
  correct: boolean;
  /** La variante accettata più vicina. */
  matched: string | null;
  distance: number;
}

const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/;

/** Token "numerici" (cifre o numeri romani fino a XXXIX): devono coincidere esattamente. */
function numericTokens(normalized: string): string {
  return normalized
    .split(' ')
    .filter((t) => /\d/.test(t) || (t.length > 0 && t.length <= 6 && ROMAN.test(t) && t !== ''))
    .sort()
    .join(' ');
}

/** Distanza fuzzy tra due stringhe già normalizzate (anche ignorando gli spazi). */
function fuzzyDistance(guess: string, target: string, max: number): number {
  if (numericTokens(guess) !== numericTokens(target)) return Infinity; // «Giorgio II» ≠ «Giorgio III», «79» ≠ «89»
  return Math.min(levenshtein(guess, target, max), levenshtein(guess.replace(/\s/g, ''), target.replace(/\s/g, ''), max));
}

/**
 * TRIVIA_OPEN: confronto fuzzy con tutte le `acceptedAnswers`
 * (tollera accenti, maiuscole, punteggiatura, articoli, spazi e qualche refuso).
 *
 * Due protezioni contro i falsi positivi:
 *  - numeri e numeri romani devono coincidere esattamente
 *  - se ciò che è stato scritto è vicino a un distrattore quanto (o più) che alla risposta,
 *    è sbagliato: «Roman Roy» non passa per «Logan Roy», «Blu e oro» non passa per «Blu e nero»
 */
export function checkOpenAnswer(q: TriviaQuestion, input: string): OpenAnswerResult {
  const guess = normalizeAnswer(input);
  const none: OpenAnswerResult = { correct: false, matched: null, distance: Infinity };
  if (!guess) return none;

  let best = none;
  for (const accepted of q.acceptedAnswers) {
    const target = normalizeAnswer(accepted);
    if (!target) continue;
    const max = tolerance(target);
    const d = fuzzyDistance(guess, target, max);
    if (d < best.distance) best = { correct: d <= max, matched: accepted, distance: d };
    if (d === 0) return best; // corrispondenza esatta: nessun dubbio
  }
  if (!best.correct) return best;

  for (const wrong of q.wrongAnswers) {
    const target = normalizeAnswer(wrong);
    const d = fuzzyDistance(guess, target, Math.max(best.distance, tolerance(target)));
    if (d <= best.distance) return { ...best, correct: false };
  }
  return best;
}

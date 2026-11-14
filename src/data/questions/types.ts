/**
 * Tipi e helper comuni del database Trivia.
 *
 * Ogni domanda funziona in DUE modalità:
 *  - TRIVIA_CHOICE: si mostrano `answer` + i 3 `wrongAnswers` mescolati (distrattori plausibili)
 *  - TRIVIA_OPEN:   si digita la risposta; vale se combacia (in modo fuzzy) con una delle
 *                   `acceptedAnswers` (che include sempre `answer`, più sinonimi/cognomi/grafie)
 */

export type TriviaCategory = 'sport' | 'musica' | 'storia' | 'geografia' | 'arte_letteratura' | 'cinema_serie' | 'pop_tech';

/** 2 = media, 3 = alta (target: pub quiz competitivo, niente domande da elementari). */
export type Difficulty = 2 | 3;

export type TriviaMode = 'TRIVIA_CHOICE' | 'TRIVIA_OPEN';

export interface TriviaQuestion {
  /** Stabile: `${categoria}-${numero}`. Aggiungere sempre IN FONDO agli array per non spostare gli id. */
  id: string;
  category: TriviaCategory;
  difficulty: Difficulty;
  question: string;
  /** Risposta corretta, come va mostrata. */
  answer: string;
  /** Tre distrattori plausibili per la modalità a scelta multipla. */
  wrongAnswers: readonly [string, string, string];
  /** Varianti accettate in modalità aperta (comprende sempre `answer`). */
  acceptedAnswers: readonly string[];
  /** Curiosità da mostrare dopo la risposta (facoltativa). */
  note?: string;
}

/** Riga compatta usata nei file di categoria: [difficoltà, domanda, risposta, distrattori, varianti?, nota?] */
export type QuestionRow = readonly [
  difficulty: Difficulty,
  question: string,
  answer: string,
  wrongAnswers: readonly [string, string, string],
  accepted?: readonly string[],
  note?: string,
];

/** Trasforma le righe compatte in domande complete, con id stabili e varianti deduplicate. */
export function defineQuestions(category: TriviaCategory, rows: readonly QuestionRow[]): TriviaQuestion[] {
  return rows.map(([difficulty, question, answer, wrongAnswers, accepted = [], note], i) => ({
    id: `${category}-${String(i + 1).padStart(3, '0')}`,
    category,
    difficulty,
    question,
    answer,
    wrongAnswers,
    acceptedAnswers: [...new Set([answer, ...accepted])],
    ...(note ? { note } : {}),
  }));
}

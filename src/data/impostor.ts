/**
 * Parole segrete per il minigioco «L'Impostore Flash».
 * Tutti ricevono la parola tranne l'impostore, che vede solo il tema.
 * Scelte per essere descrivibili con un indizio di una parola, ma non banali.
 */
export interface ImpostorWord {
  theme: string;
  word: string;
}

export const IMPOSTOR_WORDS: readonly ImpostorWord[] = [
  { theme: 'Cibo', word: 'Carbonara' },
  { theme: 'Cibo', word: 'Tiramisù' },
  { theme: 'Cibo', word: 'Arancino' },
  { theme: 'Cibo', word: 'Kebab' },
  { theme: 'Cibo', word: 'Sushi' },
  { theme: 'Cibo', word: 'Piadina' },
  { theme: 'Cibo', word: 'Lasagna' },
  { theme: 'Calcio', word: 'Rigore' },
  { theme: 'Calcio', word: 'Fuorigioco' },
  { theme: 'Calcio', word: 'VAR' },
  { theme: 'Calcio', word: 'Derby' },
  { theme: 'Calcio', word: 'Calciomercato' },
  { theme: 'Calcio', word: 'Fantacalcio' },
  { theme: 'Al pub', word: 'Spritz' },
  { theme: 'Al pub', word: 'Karaoke' },
  { theme: 'Al pub', word: 'Freccette' },
  { theme: 'Al pub', word: 'Biliardino' },
  { theme: 'Al pub', word: 'Shottino' },
  { theme: 'Al pub', word: 'Buttafuori' },
  { theme: 'Luoghi', word: 'Aeroporto' },
  { theme: 'Luoghi', word: 'Discoteca' },
  { theme: 'Luoghi', word: 'Ikea' },
  { theme: 'Luoghi', word: 'Autogrill' },
  { theme: 'Luoghi', word: 'Palestra' },
  { theme: 'Luoghi', word: 'Pronto soccorso' },
  { theme: 'Luoghi', word: 'Spiaggia libera' },
  { theme: 'Film e serie', word: 'Titanic' },
  { theme: 'Film e serie', word: 'Squid Game' },
  { theme: 'Film e serie', word: 'Harry Potter' },
  { theme: 'Film e serie', word: 'La casa di carta' },
  { theme: 'Film e serie', word: 'Shrek' },
  { theme: 'Film e serie', word: 'Il Trono di Spade' },
  { theme: 'Tecnologia', word: 'TikTok' },
  { theme: 'Tecnologia', word: 'PlayStation' },
  { theme: 'Tecnologia', word: 'Wi-Fi' },
  { theme: 'Tecnologia', word: 'Bitcoin' },
  { theme: 'Tecnologia', word: 'ChatGPT' },
  { theme: 'Tecnologia', word: 'Powerbank' },
  { theme: 'Animali', word: 'Pinguino' },
  { theme: 'Animali', word: 'Giraffa' },
  { theme: 'Animali', word: 'Polpo' },
  { theme: 'Animali', word: 'Panda' },
  { theme: 'Animali', word: 'Zanzara' },
  { theme: 'Professioni', word: 'Chirurgo' },
  { theme: 'Professioni', word: 'Influencer' },
  { theme: 'Professioni', word: 'Pompiere' },
  { theme: 'Professioni', word: 'Barista' },
  { theme: 'Professioni', word: 'Astronauta' },
  { theme: 'Eventi', word: 'Matrimonio' },
  { theme: 'Eventi', word: 'Laurea' },
];

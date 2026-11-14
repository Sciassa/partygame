/**
 * Curiosità numeriche per il minigioco «Higher / Lower — Il Prezzo è Giusto».
 * Vince chi si avvicina di più. `min`/`max` definiscono lo slider sul telefono, `step` la precisione.
 * Solo valori stabili e verificabili (niente record ancora "in corso").
 */
export interface NumberQuestion {
  id: string;
  question: string;
  answer: number;
  unit?: string;
  min: number;
  max: number;
  step: number;
  note?: string;
}

export const NUMBER_QUESTIONS: readonly NumberQuestion[] = [
  { id: 'num-01', question: 'In che anno è stato presentato il primo iPhone?', answer: 2007, min: 1995, max: 2015, step: 1 },
  { id: 'num-02', question: "Quanti metri è alto l'Everest, secondo la misurazione ufficiale del 2020?", answer: 8849, unit: 'm', min: 7000, max: 10000, step: 1 },
  { id: 'num-03', question: 'In che anno è caduto il Muro di Berlino?', answer: 1989, min: 1970, max: 2000, step: 1 },
  { id: 'num-04', question: 'Quante ossa ha il corpo umano adulto?', answer: 206, min: 100, max: 400, step: 1 },
  { id: 'num-05', question: 'Quanti chilometri è lungo il Po?', answer: 652, unit: 'km', min: 300, max: 1200, step: 1 },
  { id: 'num-06', question: 'In che anno è stata fondata Google?', answer: 1998, min: 1985, max: 2010, step: 1 },
  { id: 'num-07', question: 'In che anno è nato Facebook?', answer: 2004, min: 1995, max: 2012, step: 1 },
  { id: 'num-08', question: 'A quanti chilometri al secondo viaggia la luce nel vuoto?', answer: 299792, unit: 'km/s', min: 100000, max: 500000, step: 1000, note: '299.792 km/s.' },
  { id: 'num-09', question: 'Qual è la distanza media tra la Terra e la Luna?', answer: 384400, unit: 'km', min: 100000, max: 1000000, step: 1000 },
  { id: 'num-10', question: 'Quanti tasti ha un pianoforte standard?', answer: 88, min: 50, max: 120, step: 1 },
  { id: 'num-11', question: 'Quanti metri è lunga una maratona?', answer: 42195, unit: 'm', min: 30000, max: 50000, step: 5 },
  { id: 'num-12', question: 'In che anno si è tenuta la prima edizione del Festival di Sanremo?', answer: 1951, min: 1930, max: 1975, step: 1 },
  { id: 'num-13', question: 'Quanti canti compongono la Divina Commedia?', answer: 100, min: 30, max: 200, step: 1 },
  { id: 'num-14', question: "Quanti stati membri ha l'ONU?", answer: 193, min: 100, max: 250, step: 1 },
  { id: 'num-15', question: 'In che anno si è giocato il primo Mondiale di calcio?', answer: 1930, min: 1900, max: 1960, step: 1 },
  { id: 'num-16', question: 'Qual è il record mondiale dei 100 metri di Usain Bolt, in secondi?', answer: 9.58, unit: 's', min: 9, max: 10.5, step: 0.01 },
  { id: 'num-17', question: 'Quanti euro costava al lancio la PS5 standard con lettore, nel 2020?', answer: 500, unit: '€', min: 200, max: 900, step: 10, note: 'Esattamente 499,99 €.' },
  { id: 'num-18', question: 'In che anno è nato Leonardo da Vinci?', answer: 1452, min: 1350, max: 1550, step: 1 },
  { id: 'num-19', question: "Con quanti stati confina l'Italia?", answer: 6, min: 2, max: 12, step: 1, note: 'Francia, Svizzera, Austria, Slovenia, San Marino e Vaticano.' },
  { id: 'num-20', question: 'In che anno è avvenuta la Breccia di Porta Pia?', answer: 1870, min: 1840, max: 1900, step: 1 },
  { id: 'num-21', question: "Quanti km² è grande l'Italia, circa?", answer: 302000, unit: 'km²', min: 150000, max: 500000, step: 1000 },
  { id: 'num-22', question: 'Quanti episodi ha in tutto «Breaking Bad»?', answer: 62, min: 30, max: 120, step: 1 },
  { id: 'num-23', question: 'Quanti minuti dura «Avengers: Endgame»?', answer: 181, unit: 'min', min: 120, max: 240, step: 1 },
  { id: 'num-24', question: 'Quanti Oscar ha vinto «Titanic»?', answer: 11, min: 3, max: 15, step: 1 },
  { id: 'num-25', question: "In che anno l'Italia ha vinto per la prima volta l'Eurovision, con Gigliola Cinquetti?", answer: 1964, min: 1956, max: 1990, step: 1 },
  { id: 'num-26', question: 'In che anno è stata fondata la FIAT?', answer: 1899, min: 1870, max: 1930, step: 1 },
  { id: 'num-27', question: "A quanti gradi Fahrenheit bolle l'acqua al livello del mare?", answer: 212, unit: '°F', min: 100, max: 300, step: 1 },
  { id: 'num-28', question: 'Quanti cuori ha un polpo?', answer: 3, min: 1, max: 8, step: 1 },
  { id: 'num-29', question: 'Quanti denti ha un adulto, compresi quelli del giudizio?', answer: 32, min: 20, max: 40, step: 1 },
  { id: 'num-30', question: 'In che anno è uscita la versione completa di Minecraft?', answer: 2011, min: 2005, max: 2016, step: 1 },
  { id: 'num-31', question: 'Quanti elementi conta oggi la tavola periodica?', answer: 118, min: 90, max: 140, step: 1 },
  { id: 'num-32', question: 'In che anno è stato inviato il primo SMS della storia?', answer: 1992, min: 1975, max: 2005, step: 1, note: 'Il testo era «Merry Christmas».' },
  { id: 'num-33', question: 'Quanti metri è alto il Burj Khalifa?', answer: 828, unit: 'm', min: 400, max: 1200, step: 1 },
  { id: 'num-34', question: "Quante regioni ha l'Italia?", answer: 20, min: 10, max: 30, step: 1 },
  { id: 'num-35', question: "Quante sono le lingue ufficiali dell'Unione Europea?", answer: 24, min: 10, max: 40, step: 1 },
  { id: 'num-36', question: 'Quanti chilometri misura il diametro medio della Terra?', answer: 12742, unit: 'km', min: 5000, max: 25000, step: 10 },
  { id: 'num-37', question: 'In che anno i fratelli Wright fecero il primo volo a motore?', answer: 1903, min: 1880, max: 1930, step: 1 },
  { id: 'num-38', question: 'Quante stagioni ha «Il Trono di Spade»?', answer: 8, min: 3, max: 12, step: 1 },
  { id: 'num-39', question: 'Quanti dollari costava il primo iPhone da 4 GB al lancio negli USA?', answer: 499, unit: '$', min: 199, max: 999, step: 1 },
  { id: 'num-40', question: 'In che anno è stata fondata Apple?', answer: 1976, min: 1960, max: 1995, step: 1 },
  { id: 'num-41', question: "In che anno la popolazione mondiale ha raggiunto 8 miliardi, secondo l'ONU?", answer: 2022, min: 2010, max: 2030, step: 1 },
  { id: 'num-42', question: 'Quanti metri è lungo un giro del circuito di Monza?', answer: 5793, unit: 'm', min: 3000, max: 8000, step: 1 },
  { id: 'num-43', question: "Quanti gol ha segnato l'Italia campione a Euro 2020?", answer: 13, min: 5, max: 25, step: 1 },
  { id: 'num-44', question: 'In che anno Francesco Totti ha esordito in Serie A?', answer: 1993, min: 1985, max: 2000, step: 1 },
];

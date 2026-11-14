/**
 * BONUS SEGRETI di fine partita (stile Mario Party): 1 Pinta d'Oro a ciascun vincitore.
 * A pari merito, la Pinta va a tutti i vincitori. Se nessuno ha i requisiti, il premio salta.
 */
export function computeAwards(players) {
  const best = (entries, better) => {
    if (!entries.length) return [];
    const top = entries.reduce((acc, e) => (better(e.value, acc) ? e.value : acc), entries[0].value);
    return entries.filter((e) => Math.abs(e.value - top) < 1e-6).map((e) => e.id);
  };

  const speed = players.filter((p) => p.stats.triviaCorrect > 0).map((p) => ({ id: p.id, value: p.stats.triviaTimeMs / p.stats.triviaCorrect }));
  const builders = players.filter((p) => p.stats.stickersPlaced > 0).map((p) => ({ id: p.id, value: p.stats.stickersPlaced }));
  const targets = players.filter((p) => p.stats.malusTaken > 0).map((p) => ({ id: p.id, value: p.stats.malusTaken }));
  const fastest = best(speed, (a, b) => a < b);
  const architects = best(builders, (a, b) => a > b);
  const victims = best(targets, (a, b) => a > b);
  const valueOf = (list, ids) => list.find((e) => e.id === ids[0])?.value ?? null;

  return [
    {
      id: 'fulmine',
      icon: '⚡',
      title: 'Fulmine del Pub',
      description: 'Tempo medio più veloce nelle risposte giuste ai Trivia',
      winners: fastest,
      value: fastest.length ? `${(valueOf(speed, fastest) / 1000).toFixed(1)} s` : null,
    },
    {
      id: 'architetto',
      icon: '🏗️',
      title: 'Architetto del Caos',
      description: 'Più adesivi piazzati sulla ruota',
      winners: architects,
      value: architects.length ? `${valueOf(builders, architects)} adesivi` : null,
    },
    {
      id: 'bersaglio',
      icon: '🎯',
      title: 'Bersaglio Umano',
      description: 'Più trappole e malus subiti',
      winners: victims,
      value: victims.length ? `${valueOf(targets, victims)} colpi` : null,
    },
  ];
}

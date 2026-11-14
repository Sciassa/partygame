import { withEvent } from './common.js';

const BID_MS = 15000;
const REVEAL_MS = 6500;
export const AUCTION_PRIZE = 200;

/**
 * ASTA AL BUIO: in palio 200 Tappi. Tutti puntano in segreto.
 * Chi punta di più vince i 200 (pagando la sua puntata); il SECONDO perde la puntata senza
 * vincere nulla. A parità di puntata vince chi ha puntato prima.
 */
export async function runAuction(engine, { lander }) {
  const participants = engine.connected();
  await withEvent(engine, { kind: 'auction', stage: 'bid', prize: AUCTION_PRIZE, done: [], landerId: lander.id }, async (event) => {
    const bids = new Map();
    let order = 0;
    await engine.collect({
      ms: BID_MS,
      players: participants,
      onInput: (pid, a) => {
        if (a.kind !== 'bid' || bids.has(pid)) return false;
        const player = engine.state.getPlayer(pid);
        const amount = Math.floor(Number(a.amount));
        if (!Number.isFinite(amount) || amount < 0 || amount > player.coins) return false;
        bids.set(pid, { amount, order: order++ });
        event.done.push(pid);
        engine.eventPrivate.set(pid, { bid: amount });
        return true;
      },
      isComplete: () => bids.size >= participants.length,
    });

    const ranked = [...bids].filter(([, b]) => b.amount > 0).sort((x, y) => y[1].amount - x[1].amount || x[1].order - y[1].order);
    const [first, second] = ranked;
    let winner = null;
    if (first) {
      winner = engine.state.getPlayer(first[0]);
      const pay = Math.min(first[1].amount, winner.coins);
      engine.spend(winner, pay, 'Asta al Buio');
      engine.award(winner, AUCTION_PRIZE, { reason: 'Asta al Buio', boostable: true });
      engine.line(`🔨 Asta al Buio: ${winner.name} vince con ${first[1].amount} Tappi`, 'gold');
    } else {
      engine.line('🔨 Asta al Buio: nessuno ha puntato', 'info');
    }
    if (second) {
      const loser = engine.state.getPlayer(second[0]);
      engine.spend(loser, Math.min(second[1].amount, loser.coins), 'Asta al Buio (secondo)');
      engine.line(`🔨 ${loser.name} arriva secondo e perde ${second[1].amount} Tappi`, 'malus');
    }
    Object.assign(event, {
      stage: 'reveal',
      bids: participants.map((p) => ({ playerId: p.id, amount: bids.get(p.id)?.amount ?? null })),
      winnerId: winner?.id ?? null,
      secondId: second ? second[0] : null,
    });
    engine.changed();
    await engine.sleep(REVEAL_MS);
  });
}

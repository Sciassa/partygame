/**
 * Test mirati del regolamento «Spin & Sip»:   pnpm test:rules
 * Scenari deterministici sulle meccaniche chiave (adesivi, economia, Happy Hour, Fusto, premi).
 */
import assert from 'node:assert/strict';
import { GameState } from '../src/host/state/GameState.js';
import { GameEngine } from '../src/host/game/GameEngine.js';
import * as stickers from '../src/host/game/stickerEngine.js';
import { computeAwards } from '../src/host/game/awards.js';
import { segmentLayout, segmentIndexAt, TAU } from '../src/shared/wheel/kinematics.js';
import { BeerPoolManager } from '../src/host/state/BeerPoolManager.ts';
import { PHASE } from '../src/shared/protocol.js';
import { FlapperPhysics } from '../src/three/JuiceDirector.ts';
import { getRadiusAtY, GLASS_PROFILES, BEER_PROFILE } from '../src/three/BeerAvatarBuilder.ts';

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`  ✓ ${name}`);
    },
    (err) => {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    },
  );
}

/** Stanza con 3 giocatori e un turno "finto" in corso (lander = A). */
function setup({ rng = () => 0.99 } = {}) {
  const state = new GameState({ mode: 'salotto', roomCode: 'TEST' });
  const [A, B, C] = ['a', 'b', 'c'].map((id, i) => state.joinPlayer(`client-${id}`, `P${i}`).player);
  const engine = new GameEngine(state, { rng, log: () => {}, schedule: () => 0, cancel: () => {}, now: () => 0 });
  engine.turn = { number: 1, playerId: A.id, landerId: A.id, multiplier: 1, boost: 1, landerNet: 0, ledger: [], lines: [], bets: new Map() };
  return { state, engine, A, B, C };
}

/** Incolla un adesivo senza alterare i Tappi del giocatore (il costo non interessa al test). */
function placeAs(engine, player, stickerId, segIndex) {
  const before = player.coins;
  player.coins = 100000;
  const r = stickers.place(engine, player, stickerId, segIndex);
  player.coins = before;
  assert.ok(r.ok, r.error);
}

console.log('Regolamento Spin & Sip');

await test('Tassa di Passaggio: chi ci capita paga 50 al proprietario', async () => {
  const { engine, state, A, B } = setup();
  placeAs(engine, B, 'tassa', 0);
  await stickers.onLand(engine, 0, A);
  assert.equal(A.coins, 50);
  assert.equal(B.coins, 150);
  assert.equal(A.stats.malusTaken, 1);
  assert.equal(state.segments[0].sticker.ownerColor, B.color);
});

await test('Scudo di Titanio blocca la Tassa', async () => {
  const { engine, A, B } = setup();
  placeAs(engine, B, 'tassa', 0);
  A.status.shield = 1;
  await stickers.onLand(engine, 0, A);
  assert.equal(A.coins, 100);
  assert.equal(A.stats.malusTaken, 0);
});

await test('Specchio Riflesso rimanda la Bancarotta al proprietario', async () => {
  const { engine, A, B } = setup();
  placeAs(engine, B, 'bancarotta', 0);
  A.status.mirror = 3;
  await stickers.onLand(engine, 0, A);
  assert.equal(A.coins, 100);
  assert.equal(B.coins, 50);
  assert.equal(A.status.mirror, 0);
});

await test('Incollarlo su un proprio spicchio porta al Lv.2 (effetto raddoppiato)', async () => {
  const { engine, state, A, B } = setup();
  placeAs(engine, B, 'tassa', 0);
  placeAs(engine, B, 'tassa', 0);
  assert.equal(state.segments[0].sticker.level, 2);
  await stickers.onLand(engine, 0, A);
  assert.equal(A.coins, 0);
});

await test('Sovrascrivere un adesivo altrui costa +50%; il Lucchetto lo impedisce', () => {
  const { engine, A, B } = setup();
  placeAs(engine, B, 'tassa', 0);
  assert.equal(stickers.placementCost(engine, A, 'boost', 0).cost, 75); // 50 * 1.5
  placeAs(engine, B, 'lucchetto', 1);
  assert.equal(stickers.placementCost(engine, A, 'boost', 1).cost, null);
  assert.equal(stickers.placementCost(engine, B, 'boost', 1).cost, 50); // il proprietario può (potenziamento)
});

await test('Espansione raddoppia l\'ampiezza dello spicchio sulla ruota', () => {
  const { engine, state, A } = setup();
  placeAs(engine, A, 'espansione', 3);
  assert.equal(state.segments[3].size, 2);
  const layout = segmentLayout(state.segments);
  const span = (i) => layout[i].end - layout[i].start;
  assert.ok(Math.abs(span(3) - 2 * span(0)) < 1e-9);
  // il puntatore al centro dello spicchio espanso lo riconosce
  const mid = (layout[3].start + layout[3].end) / 2;
  assert.equal(segmentIndexAt(-mid, layout), 3);
  assert.ok(Math.abs(layout[layout.length - 1].end - TAU) < 1e-9);
});

await test('Rovina cancella l\'adesivo (e la sua Espansione)', () => {
  const { engine, state, A, B } = setup();
  placeAs(engine, B, 'espansione', 2);
  placeAs(engine, A, 'rovina', 2);
  assert.equal(state.segments[2].sticker, null);
  assert.equal(state.segments[2].size, 1);
});

await test('Happy Hour raddoppia vincite e perdite; Top Slot x3 vale solo per chi è di turno', () => {
  const { engine, A, B } = setup();
  engine.happyHour = true;
  engine.turn.multiplier = 3;
  assert.equal(engine.award(A, 40, { boostable: true }), 240); // 40 x3 (Top Slot) x2 (Happy Hour)
  assert.equal(engine.award(B, 40, { boostable: true }), 80);
  assert.equal(engine.award(B, -20), -40);
});

await test("L'Ancora blocca i guadagni ma non le perdite", () => {
  const { engine, A } = setup();
  A.status.anchor = 1;
  assert.equal(engine.award(A, 50), 0);
  assert.equal(engine.award(A, -30), -30);
});

await test('Comunismo ridistribuisce i Tappi in parti uguali', async () => {
  const { engine, A, B, C } = setup();
  A.coins = 300;
  B.coins = 0;
  C.coins = 0;
  placeAs(engine, B, 'comunismo', 0);
  await stickers.onLand(engine, 0, A);
  assert.deepEqual([A.coins, B.coins, C.coins], [100, 100, 100]);
});

await test('Jackpot accumula il 10% delle spese e paga chi ci capita', async () => {
  const { engine, state, A, B } = setup();
  placeAs(engine, B, 'jackpot', 5);
  state.segments[5].jackpot = 0; // azzera ciò che ha accumulato l'acquisto stesso
  engine.spend(B, 100, 'test');
  assert.equal(state.segments[5].jackpot, 10);
  await stickers.onLand(engine, 5, A);
  assert.equal(A.coins, 110);
  assert.equal(state.segments[5].jackpot, 0);
});

await test("Fusto d'Oro: 250 Tappi per una Pinta, poi il prezzo sale di 50", () => {
  const { engine, A, B } = setup();
  A.coins = 600;
  assert.ok(engine.buyPint(A));
  assert.equal(A.pints, 1);
  assert.equal(A.coins, 350);
  assert.equal(engine.kegPrice, 300);
  B.coins = 299;
  assert.ok(!engine.buyPint(B));
});

await test('Classifica: prima le Pinte, a parità i Tappi', () => {
  const { engine, A, B, C } = setup();
  A.pints = 1;
  A.coins = 10;
  B.pints = 1;
  B.coins = 500;
  C.pints = 0;
  C.coins = 9999;
  assert.deepEqual(engine.rankingOf().map((p) => p.id), [B.id, A.id, C.id]);
});

await test('Sabotaggi: colpiscono tutti tranne il proprietario; Sabotaggio solo il primo', async () => {
  const { engine, A, B, C } = setup();
  placeAs(engine, B, 'blackout', 0);
  await stickers.onLand(engine, 0, A);
  C.coins = 999; // C in testa
  engine.pendingSabotages.push({ id: 'sabotaggio', name: 'Sabotaggio', icon: '🐌', ownerId: B.id, events: 1 });
  engine.beginEventSabotage();
  assert.equal(engine.sabotageFlags(A.id).blackout, true);
  assert.equal(engine.sabotageFlags(B.id).blackout, false);
  assert.equal(engine.sabotageFlags(C.id).delay, true);
  assert.equal(engine.sabotageFlags(A.id).delay, false);
  engine.endEventSabotage();
  assert.equal(engine.pendingSabotages.length, 0);
});

await test('Bonus Segreti: Fulmine, Architetto, Bersaglio (con pari merito)', () => {
  const { A, B, C } = setup();
  A.stats.triviaCorrect = 2;
  A.stats.triviaTimeMs = 6000;
  B.stats.triviaCorrect = 1;
  B.stats.triviaTimeMs = 2000;
  A.stats.stickersPlaced = 3;
  C.stats.stickersPlaced = 3;
  B.stats.malusTaken = 4;
  const [fulmine, architetto, bersaglio] = computeAwards([A, B, C]);
  assert.deepEqual(fulmine.winners, [B.id]);
  assert.deepEqual(architetto.winners.sort(), [A.id, C.id].sort());
  assert.deepEqual(bersaglio.winners, [B.id]);
});



console.log('\nBirre, Bancone, emote, fisica del puntatore');

await test('BeerPoolManager: birre uniche, cambio solo verso birre libere, rilascio', () => {
  const pool = new BeerPoolManager({ pick: () => 0 });
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const beers = ids.map((id) => pool.assign(id));
  assert.equal(new Set(beers).size, 12);
  assert.equal(pool.free.length, 0);
  assert.throws(() => pool.assign('p99'));
  assert.equal(pool.request('p0', beers[1]), 'taken');
  assert.equal(pool.request('p0', beers[0]), 'same');
  assert.equal(pool.request('p0', 'acqua'), 'invalid');
  pool.release('p1');
  assert.deepEqual(pool.free, [beers[1]]);
  assert.equal(pool.request('p0', beers[1]), 'ok');
  assert.deepEqual(pool.free, [beers[0]]);
  assert.ok(pool.check());
  assert.equal(pool.snapshot().p0, beers[1]);
});

await test('Cambio birra: permesso in lobby e prima del primo lancio, poi chiuso', () => {
  const { engine, state, A, B } = setup();
  assert.ok(engine.canChangeBeer());
  assert.equal(state.setBeer(A.id, B.beer), 'taken');
  const free = state.beerPool[0];
  assert.equal(state.setBeer(A.id, free), 'ok');
  assert.equal(A.beer, free);
  engine.phase = PHASE.SHOP;
  assert.ok(engine.canChangeBeer(), 'in partita ma prima del primo lancio');
  engine.firstSpinDone = true;
  assert.equal(engine.canChangeBeer(), false);
});

await test('Taglia: costa 40, chi fa perdere Tappi al bersaglio con un adesivo incassa 60', async () => {
  const { engine, A, B, C } = setup();
  engine.phase = PHASE.SHOP;
  assert.ok(engine.handleAction(C.id, { kind: 'counter_bounty', targetId: A.id }));
  assert.equal(C.coins, 60);
  assert.ok(engine.snapshot().players.find((p) => p.id === A.id).marks.bounty);
  assert.equal(engine.handleAction(B.id, { kind: 'counter_bounty', targetId: A.id }), false, 'una taglia alla volta');
  placeAs(engine, B, 'tassa', 0);
  await stickers.onLand(engine, 0, A);
  assert.equal(B.coins, 100 + 50 + 60);
  assert.equal(engine.bounties.size, 0);
});

await test('Taglia: scade dopo 2 turni', () => {
  const { engine, A, C } = setup();
  engine.phase = PHASE.BETTING;
  engine.handleAction(C.id, { kind: 'counter_bounty', targetId: A.id });
  engine.bounties.get(A.id).turnsLeft -= 1;
  assert.equal(engine.bounties.get(A.id).turnsLeft, 1);
});

await test('Sottobanco: trasferimento segreto, uno per turno, solo a bancone aperto', () => {
  const { engine, A, B } = setup();
  const events = [];
  engine.onEvent = (e) => events.push(e);
  engine.phase = PHASE.LANDING;
  assert.equal(engine.handleAction(A.id, { kind: 'counter_slip', targetId: B.id, amount: 20 }), false);
  engine.phase = PHASE.AWAIT_SPIN;
  assert.ok(engine.handleAction(A.id, { kind: 'counter_slip', targetId: B.id, amount: 50 }));
  assert.equal(A.coins, 50);
  assert.equal(B.coins, 150);
  assert.equal(engine.handleAction(A.id, { kind: 'counter_slip', targetId: B.id, amount: 20 }), false);
  assert.equal(engine.handleAction(A.id, { kind: 'counter_slip', targetId: B.id, amount: 33 }), false);
  assert.ok(events.some((e) => e.type === 'sneaky'));
});

await test('Shot: uno nel taschino, si usa solo nel proprio turno', () => {
  const { engine, A, B } = setup();
  engine.phase = PHASE.SHOP;
  engine.turnPlayerId = A.id;
  assert.ok(engine.handleAction(B.id, { kind: 'counter_buy', shot: 'tequila' }));
  assert.equal(B.coins, 50);
  assert.equal(engine.handleAction(B.id, { kind: 'counter_buy', shot: 'assenzio' }), false, 'taschino pieno');
  assert.equal(engine.handleAction(B.id, { kind: 'counter_use' }), false, 'non è il suo turno');
  assert.ok(engine.handleAction(A.id, { kind: 'counter_buy', shot: 'analcolica' }));
  assert.ok(engine.handleAction(A.id, { kind: 'counter_use', targetId: B.id }));
  assert.equal(B.status.wet, true);
  assert.equal(A.shot, null);
  engine.event = { kind: 'trivia' };
  assert.equal(engine.privateFor(B.id).sabotage.foam, true);
  assert.equal(engine.privateFor(A.id).sabotage.foam, false);
  engine.dryOff();
  assert.equal(B.status.wet, false);
});

await test('Tequila: guadagni dell\'evento x2.5', () => {
  const { engine, A } = setup();
  engine.turn.tequila = true;
  engine.turn.eventWindow = true;
  engine.turn.tequilaGain = 0;
  assert.equal(engine.award(A, 40, { reason: 'Trivia' }), 100);
  assert.equal(engine.turn.tequilaGain, 100);
});

await test('Assenzio: le trappole dei nemici sono riconosciute come tali', () => {
  assert.ok(stickers.isTrap('tassa'));
  assert.ok(stickers.isTrap('blackout'));
  assert.equal(stickers.isTrap('jackpot'), false);
});

await test('Emote: cooldown di 2.5 s per giocatore', () => {
  let now = 0;
  const { engine, A, B } = setup();
  engine.now = () => now;
  assert.ok(engine.emote(A.id, 'cheers'));
  now = 1000;
  assert.equal(engine.emote(A.id, 'boo'), false);
  assert.ok(engine.emote(B.id, 'boo'));
  now = 2600;
  assert.ok(engine.emote(A.id, 'fire'));
  assert.equal(engine.emote(A.id, 'dance'), false);
});

await test('Puntatore: conta tutti i pioli attraversati e la molla torna a riposo', () => {
  const f = new FlapperPhysics();
  const bounds = segmentLayout(12).map((l) => l.start);
  f.countCrossings(0.1, bounds);
  assert.equal(f.countCrossings(0.1 + (TAU / 12) * 3, bounds), 3);
  f.countCrossings(0.1, bounds);
  assert.equal(f.countCrossings(TAU - 0.1, bounds), 1, 'passaggio per lo 0 (da 0.1 a 2π-0.1 all\'indietro)');
  f.velocity = 12;
  for (let i = 0; i < 400; i++) f.update(1 / 60);
  assert.ok(Math.abs(f.angle) < 1e-3 && Math.abs(f.velocity) < 1e-2);
});

await test('Bicchieri: profili coerenti e 12 birre mappate su 4 forme', () => {
  assert.equal(Object.keys(BEER_PROFILE).length, 12);
  assert.equal(getRadiusAtY('PINT_GLASS', 0.85 / 1.1).toFixed(2), '0.38');
  assert.equal(getRadiusAtY('WEISS_TALL', 1).toFixed(2), '0.34');
  assert.ok(Math.abs(getRadiusAtY('TULIP_STEM', 0.2 / 1.04) - 0.07) < 1e-9, 'stelo');
  for (const p of Object.values(GLASS_PROFILES)) assert.equal(p.points.at(-1)[1], p.height);
});

console.log(`\n${passed} test superati`);

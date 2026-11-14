import { OVERWRITE_SURCHARGE, SHOP_OFFER_SIZE, STICKERS, getSticker } from '../../data/stickers.ts';
import { segmentName } from '../../shared/wheel/segments.js';
import { runDuel } from './events/trivia.js';

/**
 * Regole degli adesivi (catalogo e testi in src/data/stickers.ts).
 * Funzioni pure sopra il GameEngine: negozio, piazzamento, Calamita, Jackpot ed effetti.
 */

// ------------------------------------------------------------------ negozio

/** 3 adesivi casuali e diversi dal catalogo. */
export function drawOffers(engine) {
  const pool = [...STICKERS];
  const offers = [];
  while (offers.length < SHOP_OFFER_SIZE && pool.length) {
    const i = Math.floor(engine.rng() * pool.length) % pool.length;
    offers.push(pool.splice(i, 1)[0].id);
  }
  return offers;
}

/**
 * Quanto costa incollare `stickerId` su ogni spicchio per `player` (null = non permesso).
 * Regole: spicchio libero = prezzo base; proprio = potenziamento al Lv.2 (prezzo base);
 * di un altro = +50%; con Lucchetto attivo di un altro = vietato; la Rovina serve solo dove c'è un adesivo.
 */
export function placementCost(engine, player, stickerId, segmentIndex) {
  const def = getSticker(stickerId);
  const segment = engine.state.segments[segmentIndex];
  if (!def || !segment) return { cost: null, error: 'Spicchio non valido' };
  const existing = segment.sticker;
  if (existing && existing.ownerId !== player.id && existing.lockedTurns > 0) return { cost: null, error: 'Spicchio protetto dal Lucchetto' };
  if (def.id === 'rovina') {
    if (!existing) return { cost: null, error: 'La Rovina serve su uno spicchio con un adesivo' };
    return { cost: def.cost, mode: 'ruin' };
  }
  if (!existing) return { cost: def.cost, mode: 'new' };
  if (existing.ownerId === player.id) {
    if (existing.level >= 2 && existing.id === def.id) return { cost: null, error: 'Già al livello massimo' };
    return { cost: def.cost, mode: 'upgrade' };
  }
  return { cost: Math.ceil(def.cost * (1 + OVERWRITE_SURCHARGE)), mode: 'overwrite' };
}

/** Vista di un'offerta per il telefono di chi compra: dati dell'adesivo + costo spicchio per spicchio. */
export function offerView(engine, player, stickerId) {
  const def = getSticker(stickerId);
  return {
    ...def,
    costs: engine.state.segments.map((_, i) => placementCost(engine, player, stickerId, i).cost),
  };
}

export function place(engine, player, stickerId, segmentIndex) {
  const def = getSticker(stickerId);
  const { cost, error, mode } = placementCost(engine, player, stickerId, segmentIndex);
  if (cost === null) return { ok: false, error };
  if (!engine.spend(player, cost, `adesivo ${def.name}`)) return { ok: false, error: `Servono ${cost} Tappi` };
  const segment = engine.state.segments[segmentIndex];
  const where = segmentName(segment, segmentIndex);
  player.stats.stickersPlaced += 1;

  if (mode === 'ruin') {
    const ruined = segment.sticker;
    clearSegment(segment);
    engine.line(`🧨 ${player.name} usa la Rovina su ${where}: addio ${ruined.name}`, 'malus');
    engine.emit({ type: 'sticker', segmentIndex, playerId: player.id, stickerId });
    return { ok: true };
  }

  const level = mode === 'upgrade' ? 2 : 1;
  const keepJackpot = segment.sticker?.id === 'jackpot' && def.id === 'jackpot' ? segment.jackpot : 0;
  clearSegment(segment);
  segment.sticker = {
    id: def.id,
    name: def.name,
    icon: def.icon,
    ownerId: player.id,
    ownerColor: player.color,
    level,
    lockedTurns: def.id === 'lucchetto' ? 5 * level : 0,
    placedTurn: engine.turnNumber,
  };
  segment.jackpot = keepJackpot;
  if (def.id === 'espansione') segment.size = 1 + level; // 2 o 3: la ruota 3D si ridisegna

  const verb = mode === 'upgrade' ? 'potenzia al Lv.2' : mode === 'overwrite' ? 'sovrascrive' : 'incolla';
  engine.line(`${def.icon} ${player.name} ${verb} «${def.name}» su ${where} (${cost} Tappi)`, 'info');
  engine.emit({ type: 'sticker', segmentIndex, playerId: player.id, stickerId });
  return { ok: true };
}

function clearSegment(segment) {
  segment.sticker = null;
  segment.size = 1;
  segment.jackpot = 0;
}

// ------------------------------------------------------------------ passivi

/** Il 10% (20% al Lv.2) di ogni spesa finisce nei montepremi dei Jackpot sulla ruota. */
export function feedJackpots(engine, amount) {
  for (const segment of engine.state.segments) {
    if (segment.sticker?.id === 'jackpot') segment.jackpot += Math.round(amount * 0.1 * segment.sticker.level);
  }
}

/** Calamita: se la ruota si ferma accanto a uno spicchio magnetico, può scivolarci sopra. */
export function magnetPull(engine, landedIndex) {
  const segments = engine.state.segments;
  const n = segments.length;
  if (segments[landedIndex]?.sticker?.id === 'calamita') return null;
  for (const neighbor of [(landedIndex + 1) % n, (landedIndex - 1 + n) % n]) {
    const s = segments[neighbor].sticker;
    if (s?.id === 'calamita' && engine.rng() < 0.4 * s.level) return neighbor;
  }
  return null;
}

// ------------------------------------------------------------------ effetti all'atterraggio

/**
 * Applica l'adesivo dello spicchio a chi ci è capitato. Può essere asincrono (Sfida 1v1).
 */
export async function onLand(engine, segmentIndex, lander) {
  const segment = engine.state.segments[segmentIndex];
  const sticker = segment.sticker;
  if (!sticker) return;
  const owner = engine.state.getPlayer(sticker.ownerId);
  await applyEffect(engine, { id: sticker.id, level: sticker.level, owner, lander, segment });
  if (sticker.id !== 'copia') engine.lastSticker = { id: sticker.id, level: sticker.level, ownerId: sticker.ownerId };
}

/** Bersaglio di un malus: lo Specchio lo rimbalza sul proprietario dell'adesivo. */
function malusTarget(engine, victim, owner, def) {
  if (victim.status.mirror > 0 && owner && owner.id !== victim.id) {
    victim.status.mirror = 0;
    engine.line(`🪞 Lo Specchio di ${victim.name} riflette «${def.name}» su ${owner.name}!`, 'bonus');
    return owner;
  }
  return victim;
}

/** Lo Scudo blocca malus e trappole; altrimenti il colpo conta per «Bersaglio Umano». */
function hit(engine, target, def) {
  if (target.status.shield > 0) {
    engine.line(`🛡️ Lo Scudo di ${target.name} blocca «${def.name}»`, 'bonus');
    return false;
  }
  target.stats.malusTaken += 1;
  return true;
}

async function applyEffect(engine, { id, level: lv, owner, lander, segment }) {
  const def = getSticker(id);
  const others = engine.connected().filter((p) => p.id !== lander.id);
  const say = (text, tone = 'info') => engine.line(`${def.icon} ${def.name}: ${text}`, tone);

  switch (id) {
    // ------------------------------------------------ economia
    case 'tassa': {
      const target = malusTarget(engine, lander, owner, def);
      if (!hit(engine, target, def)) return;
      const paid = -engine.award(target, -50 * lv, { reason: def.name, raw: true });
      if (owner && owner.id !== target.id && paid > 0) engine.award(owner, paid, { reason: def.name, raw: true });
      say(`${target.name} paga ${paid} Tappi${owner && owner.id !== target.id ? ` a ${owner.name}` : ''}`, 'malus');
      return;
    }
    case 'robin': {
      const leader = engine.rankingOf()[0];
      if (!leader || !hit(engine, leader, def)) return;
      const taken = -engine.award(leader, -Math.floor(leader.coins * 0.2 * lv), { reason: def.name, raw: true });
      const rest = engine.connected().filter((p) => p.id !== leader.id);
      const share = rest.length ? Math.floor(taken / rest.length) : 0;
      for (const p of rest) engine.award(p, share, { reason: def.name, raw: true });
      say(`${leader.name} (in testa) perde ${taken} Tappi, ${share} a testa agli altri`, 'malus');
      return;
    }
    case 'bancarotta': {
      const target = malusTarget(engine, lander, owner, def);
      if (!hit(engine, target, def)) return;
      const lost = -engine.award(target, -Math.floor(target.coins * (lv > 1 ? 0.75 : 0.5)), { reason: def.name, raw: true });
      say(`${target.name} perde ${lost} Tappi`, 'malus');
      return;
    }
    case 'jackpot': {
      const pot = segment.jackpot;
      segment.jackpot = 0;
      if (!pot) return say('il montepremi è vuoto');
      const won = engine.award(lander, pot, { reason: def.name, raw: true });
      say(`${lander.name} vince il montepremi: +${won} Tappi`, 'gold');
      return;
    }
    case 'boost':
      engine.turn.boost = lv > 1 ? 3 : 2;
      say(`i premi di ${lander.name} in questo turno valgono x${engine.turn.boost}`, 'bonus');
      return;
    case 'sanguisuga': {
      let total = 0;
      for (const victim of others) {
        if (victim.status.shield > 0) continue;
        victim.stats.malusTaken += 1;
        total += -engine.award(victim, -15 * lv, { reason: def.name, raw: true });
      }
      const got = engine.award(lander, total, { reason: def.name, raw: true });
      say(`${lander.name} succhia ${got} Tappi agli altri`, 'bonus');
      return;
    }
    case 'cashback': {
      const amount = Math.min(Math.floor(lander.stats.spent * 0.25 * lv), 150 * lv);
      const got = engine.award(lander, amount, { reason: def.name, raw: true });
      say(`${lander.name} recupera ${got} Tappi`, 'bonus');
      return;
    }
    case 'comunismo': {
      const everyone = engine.connected();
      const total = everyone.reduce((sum, p) => sum + p.coins, 0);
      const each = Math.floor(total / everyone.length);
      for (const p of everyone) engine.award(p, each - p.coins, { reason: def.name, raw: true, bypassAnchor: true });
      if (lv > 1 && owner) engine.award(owner, 50, { reason: def.name, raw: true });
      say(`tutti ora hanno ${each} Tappi`, 'info');
      return;
    }
    case 'dividendo': {
      for (const p of engine.connected()) engine.award(p, 20 * lv, { reason: def.name });
      if (owner) engine.award(owner, 60 * lv, { reason: def.name });
      say(`${20 * lv} Tappi a tutti${owner ? `, ${60 * lv} in più a ${owner.name}` : ''}`, 'bonus');
      return;
    }

    // ------------------------------------------------ posizione e strategia
    case 'scambio': {
      const ranking = engine.rankingOf();
      const other = lv > 1 ? ranking[0] : ranking[ranking.length - 1];
      if (!other || other.id === lander.id) return say('nessuno con cui scambiare');
      swapCoins(engine, lander, other, def);
      return;
    }
    case 'sorpasso': {
      const ranking = engine.rankingOf();
      const idx = ranking.findIndex((p) => p.id === lander.id);
      const above = ranking[idx - lv];
      if (!above || above.coins <= lander.coins) return say(`${lander.name} non ha nessuno da sorpassare`);
      swapCoins(engine, lander, above, def);
      return;
    }
    case 'calamita':
    case 'lucchetto':
    case 'espansione':
    case 'rovina':
      return; // effetti passivi o già applicati al piazzamento
    case 'scudo':
      lander.status.shield = Math.max(lander.status.shield, 2 * lv);
      say(`${lander.name} è immune ai malus per ${2 * lv} turni`, 'bonus');
      return;
    case 'ancora': {
      const target = malusTarget(engine, lander, owner, def);
      if (!hit(engine, target, def)) return;
      target.status.anchor = Math.max(target.status.anchor, lv);
      say(`${target.name} non guadagnerà Tappi per ${lv} turn${lv > 1 ? 'i' : 'o'}`, 'malus');
      return;
    }
    case 'voto_segreto':
      engine.hiddenTurns = Math.max(engine.hiddenTurns, 3 * lv);
      say(`la classifica è nascosta per ${3 * lv} turni`, 'info');
      return;
    case 'sfida': {
      if (!others.length) return say('nessun rivale disponibile');
      const rivalId = await engine.choose({
        player: lander,
        kind: 'duel',
        title: `⚔️ Sfida 1v1: scegli il rivale (in palio ${100 * lv} Tappi)`,
        options: others.map((p) => ({ value: p.id, label: p.name })),
        fallback: engine.pick(others).id,
      });
      const rival = engine.state.getPlayer(rivalId);
      say(`${lander.name} sfida ${rival.name}!`, 'info');
      await runDuel(engine, { a: lander, b: rival, stake: 100 * lv });
      return;
    }

    // ------------------------------------------------ manipolazione ruota
    case 'buco_nero': {
      const target = malusTarget(engine, lander, owner, def);
      if (!hit(engine, target, def)) return;
      target.status.skip += lv;
      say(`${target.name} salterà ${lv > 1 ? 'i prossimi 2 turni' : 'il prossimo turno'}`, 'malus');
      return;
    }
    case 'specchio':
      lander.status.mirror = Math.max(lander.status.mirror, 3 * lv);
      say(`${lander.name} rifletterà il prossimo malus (per ${3 * lv} turni)`, 'bonus');
      return;
    case 'roulette': {
      if (engine.rng() < 0.5) {
        const got = engine.award(lander, Math.min(lander.coins, 150 * lv), { reason: def.name, raw: true });
        say(`bang a salve! ${lander.name} vince ${got} Tappi`, 'bonus');
      } else {
        const lost = -engine.award(lander, -Math.floor(lander.coins / 2), { reason: def.name, raw: true });
        say(`colpo! ${lander.name} perde ${lost} Tappi`, 'malus');
      }
      return;
    }
    case 'copia': {
      const last = engine.lastSticker;
      if (!last || last.id === 'copia') return say("nessun adesivo da copiare");
      const copied = getSticker(last.id);
      say(`copia «${copied.name}»${lv > 1 ? ' due volte' : ''}`, 'info');
      for (let i = 0; i < lv; i++) {
        await applyEffect(engine, { id: last.id, level: last.level, owner: engine.state.getPlayer(last.ownerId) ?? owner, lander, segment });
      }
      return;
    }

    // ------------------------------------------------ sabotaggi
    case 'dittatura':
      engine.dictatorQueue.push({ ownerId: owner?.id ?? lander.id, count: lv });
      say(`${owner?.name ?? lander.name} sceglierà la categoria del prossimo Trivia`, 'info');
      return;
    case 'blackout':
    case 'dito_tremante':
    case 'fuso_orario':
    case 'sabotaggio':
    case 'dislessia':
      engine.pendingSabotages.push({ id, name: def.name, icon: def.icon, ownerId: owner?.id ?? null, events: lv });
      say(`scatterà nel prossimo evento sui telefoni${lv > 1 ? ' (per 2 eventi)' : ''}`, 'malus');
      return;
    case 'rewind': {
      const snapshot = engine.coinHistory[engine.coinHistory.length - 1 - lv];
      if (!snapshot || !snapshot.has(lander.id)) return say('non c\'è un turno a cui tornare');
      const before = lander.coins;
      const target = snapshot.get(lander.id);
      engine.award(lander, target - before, { reason: def.name, raw: true, bypassAnchor: true });
      say(`${lander.name} torna a ${target} Tappi (prima ne aveva ${before})`, target >= before ? 'bonus' : 'malus');
      return;
    }
    default:
      return;
  }
}

function swapCoins(engine, a, b, def) {
  const ca = a.coins;
  const cb = b.coins;
  engine.award(a, cb - ca, { reason: def.name, raw: true, bypassAnchor: true });
  engine.award(b, ca - cb, { reason: def.name, raw: true, bypassAnchor: true });
  engine.line(`${def.icon} ${def.name}: ${a.name} e ${b.name} si scambiano i Tappi (${ca} ↔ ${cb})`, 'info');
}


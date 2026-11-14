import { PHASE } from '../../shared/protocol.js';
import { COUNTER, EMOTE_COOLDOWN_MS, EMOTE_IDS } from '../../shared/game/counter.js';

/**
 * «🍻 Bancone & Sottobanco» lato host (regole in shared/game/counter.js).
 * Tutto è validato qui: i telefoni mandano solo intenzioni (ACTION counter_*).
 *
 * Stato:
 *  - engine.bounties: Map<targetId, { placerId, turnsLeft }>
 *  - player.shot: id dello shot nell'inventario (uno solo) o null
 *  - player.status.absinthe / tequila / wet: effetti in attesa
 */

const OPEN_PHASES = new Set([PHASE.SHOP, PHASE.BETTING, PHASE.AWAIT_SPIN]);

export function counterOpen(engine) {
  return OPEN_PHASES.has(engine.phase);
}

/** Gestisce un'azione del Bancone. Restituisce null se l'azione non è del Bancone. */
export function handleCounterAction(engine, player, action) {
  if (typeof action.kind !== 'string' || !action.kind.startsWith('counter_')) return null;
  if (!player.connected) return false;
  if (!counterOpen(engine)) {
    engine.toast(player.id, '🍻 Il bancone apre a inizio turno');
    return false;
  }
  switch (action.kind) {
    case 'counter_bounty':
      return placeBounty(engine, player, action.targetId);
    case 'counter_slip':
      return slip(engine, player, action.targetId, action.amount);
    case 'counter_buy':
      return buyShot(engine, player, action.shot);
    case 'counter_use':
      return useShot(engine, player, action.targetId);
    default:
      return false;
  }
}

function opponent(engine, player, targetId) {
  const target = engine.state.getPlayer(targetId);
  if (!target || !target.connected || target.id === player.id) return null;
  return target;
}

function placeBounty(engine, player, targetId) {
  const target = opponent(engine, player, targetId);
  if (!target) return false;
  if (engine.bounties.has(target.id)) {
    engine.toast(player.id, `🎯 C'è già una taglia su ${target.name}`);
    return false;
  }
  if (!engine.spend(player, COUNTER.bounty.cost, 'Taglia')) {
    engine.toast(player.id, `🎯 Servono ${COUNTER.bounty.cost} Tappi`);
    return false;
  }
  engine.bounties.set(target.id, { placerId: player.id, turnsLeft: COUNTER.bounty.turns });
  engine.line(`🎯 TAGLIA su ${target.name}! Chi lo batte in Sfida o gli fa perdere Tappi incassa ${COUNTER.bounty.reward}`, 'gold');
  engine.emit({ type: 'bounty', targetId: target.id });
  engine.changed();
  return true;
}

function slip(engine, player, targetId, amount) {
  const target = opponent(engine, player, targetId);
  if (!target || !COUNTER.slipAmounts.includes(amount)) return false;
  if (player.counterSlipTurn === engine.turnNumber) {
    engine.toast(player.id, '🤫 Un solo passaggio sottobanco per turno');
    return false;
  }
  if (player.coins < amount) {
    engine.toast(player.id, `🤫 Non hai ${amount} Tappi`);
    return false;
  }
  // un trasferimento tra giocatori: niente moltiplicatori, niente Jackpot, l'Ancora non lo blocca
  player.coins -= amount;
  player.counterSlipTurn = engine.turnNumber;
  engine.award(target, amount, { reason: 'Sottobanco', raw: true, bypassAnchor: true });
  engine.toast(target.id, `🤫 ${player.name} ti ha passato ${amount} Tappi sottobanco`);
  engine.toast(player.id, `🤫 Hai passato ${amount} Tappi a ${target.name}`);
  engine.line('🕵️ Movimento sospetto al bancone!', 'info');
  engine.emit({ type: 'sneaky' });
  engine.changed();
  return true;
}

function buyShot(engine, player, shotId) {
  const shot = COUNTER.shots[shotId];
  if (!shot) return false;
  if (player.shot) {
    engine.toast(player.id, '🥃 Hai già uno shot nel taschino');
    return false;
  }
  if (!engine.spend(player, shot.price, shot.name)) {
    engine.toast(player.id, `🥃 Servono ${shot.price} Tappi`);
    return false;
  }
  player.shot = shot.id;
  engine.toast(player.id, `${shot.icon} ${shot.name} nel taschino: usalo nel tuo turno prima di lanciare`);
  engine.changed();
  return true;
}

function useShot(engine, player, targetId) {
  const shot = COUNTER.shots[player.shot];
  if (!shot) return false;
  if (engine.turnPlayerId !== player.id) {
    engine.toast(player.id, '🥃 Lo shot si usa nel tuo turno, prima di lanciare');
    return false;
  }
  if (shot.id === 'analcolica') {
    const target = opponent(engine, player, targetId);
    if (!target) return false;
    target.status.wet = true;
    engine.line(`🫗 ${player.name} lancia una Birra Analcolica addosso a ${target.name}! Al prossimo Trivia avrà le risposte nella schiuma`, 'malus');
    engine.emit({ type: 'splash', playerId: player.id, targetId: target.id });
  } else if (shot.id === 'assenzio') {
    player.status.absinthe = true;
    engine.line(`🧪 ${player.name} butta giù un Assenzio: trappole nemiche e royalties ignorate in questo lancio`, 'bonus');
    engine.emit({ type: 'shot', playerId: player.id, shot: shot.id });
  } else {
    player.status.tequila = true;
    engine.line(`🍋 ${player.name} fa Tequila Bum Bum: il prossimo evento vale x2.5 (o -50)`, 'gold');
    engine.emit({ type: 'shot', playerId: player.id, shot: shot.id });
  }
  player.shot = null;
  engine.changed();
  return true;
}

/** Riscossione della taglia: `hunter` ha battuto o fatto perdere Tappi al bersaglio. */
export function claimBounty(engine, target, hunter, why) {
  if (!target || !hunter || target.id === hunter.id) return false;
  const bounty = engine.bounties.get(target.id);
  if (!bounty) return false;
  engine.bounties.delete(target.id);
  const won = engine.award(hunter, COUNTER.bounty.reward, { reason: 'Taglia', raw: true, bypassAnchor: true });
  engine.line(`🎯 ${hunter.name} riscuote la taglia su ${target.name} (${why}): +${won} Tappi`, 'gold');
  engine.emit({ type: 'bounty_claimed', targetId: target.id, playerId: hunter.id });
  return true;
}

/** Fine turno: le taglie scadono dopo 2 turni (i Tappi restano alla banca). */
export function tickBounties(engine) {
  for (const [targetId, bounty] of engine.bounties) {
    bounty.turnsLeft -= 1;
    if (bounty.turnsLeft <= 0) {
      engine.bounties.delete(targetId);
      const target = engine.state.getPlayer(targetId);
      if (target) engine.line(`🎯 La taglia su ${target.name} scade: nessuno l'ha riscossa`, 'info');
    }
  }
}

/** Segni pubblici sulla birra 3D. */
export function playerMarks(engine, player) {
  return { bounty: engine.bounties.has(player.id), wet: Boolean(player.status.wet) };
}

/** Dati privati del Bancone per il telefono. */
export function counterView(engine, player) {
  return {
    open: counterOpen(engine),
    shot: player.shot ?? null,
    canUseShot: Boolean(player.shot) && counterOpen(engine) && engine.turnPlayerId === player.id,
    slipUsed: player.counterSlipTurn === engine.turnNumber,
    bounties: [...engine.bounties.keys()],
  };
}

/** Emote: valida cooldown (2.5 s) e id. Restituisce true se va trasmessa a tutti. */
export function acceptEmote(engine, player, emote) {
  if (!player?.connected || !EMOTE_IDS.includes(emote)) return false;
  const now = engine.now();
  const last = engine.emoteAt.get(player.id) ?? -Infinity;
  if (now - last < EMOTE_COOLDOWN_MS - 150) return false; // 150 ms di tolleranza per la latenza
  engine.emoteAt.set(player.id, now);
  return true;
}

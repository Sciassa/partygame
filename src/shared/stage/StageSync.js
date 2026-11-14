import { PHASE } from '../protocol.js';
import { topSlotRevealMs } from '../game/display.js';

/** Fasi in cui lo spicchio d'arrivo resta evidenziato sulla ruota. */
const HIGHLIGHT_PHASES = new Set([PHASE.LANDING, PHASE.CHOICE, PHASE.EVENT, PHASE.TURN_RESULT]);

/**
 * Collega gli snapshot/eventi dell'host a uno StageRenderer (e, se c'è, al Top Slot DOM).
 * Stessa logica per lo schermo Salotto e per i telefoni in Pocket.
 * Gli spin sono deduplicati per plan.id: arrivano sia come evento SPIN_START sia dentro STATE
 * (quest'ultimo serve a chi si collega/ricollega a ruota già in movimento).
 */
export class StageSync {
  #segmentsKey = '';
  #playingId = null;
  #lastFinishedId = 0;
  #revealTimer = null;

  constructor(stage, { topSlot = null, overlayTopSlot: _overlay = true } = {}) {
    this.stage = stage;
    this.topSlot = topSlot;
  }

  applyState(s) {
    const key = JSON.stringify(s.wheel.segments);
    if (key !== this.#segmentsKey) {
      this.#segmentsKey = key;
      this.stage.setSegments(s.wheel.segments);
    }
    this.stage.setPlayers(s.players, s.turnPlayerId, s.phase);
    this.stage.setHappyHour(Boolean(s.turn?.happyHour));

    if (s.spin) {
      this.playSpin(s.spin.plan, s.spin.elapsed, s.spin.topSlot);
      return;
    }
    if (this.#playingId !== null) return; // la nostra animazione sta ancora finendo

    this.stage.setAngle(s.wheel.angle);
    // Top Slot: resta visibile (con cornice sullo spicchio) fino a fine turno
    if (s.topSlot && s.phase !== PHASE.AWAIT_SPIN) {
      this.stage.setTopSlot(s.topSlot.segmentIndex);
      this.topSlot?.show(s.topSlot);
    } else {
      this.stage.setTopSlot(-1);
      this.topSlot?.hide();
    }
    if (HIGHLIGHT_PHASES.has(s.phase) && s.landing) {
      this.stage.setHighlight(s.landing.segmentIndex);
    } else {
      this.stage.setHighlight(-1);
      this.stage.setLights('idle');
    }
  }

  playSpin(plan, elapsed = 0, topSlot = null) {
    if (plan.id === this.#playingId || plan.id <= this.#lastFinishedId) return;
    this.#playingId = plan.id;
    if (topSlot && plan.kind !== 'ease') {
      const revealIn = topSlotRevealMs(plan) - elapsed;
      this.stage.setTopSlot(-1);
      this.topSlot?.spin(topSlot, revealIn);
      clearTimeout(this.#revealTimer);
      this.#revealTimer = setTimeout(() => this.stage.setTopSlot(topSlot.segmentIndex), Math.max(0, revealIn));
    }
    this.stage.playSpin(plan, elapsed).then((index) => {
      if (this.#playingId === plan.id) {
        this.#playingId = null;
        this.#lastFinishedId = plan.id;
      }
      if (topSlot && index === topSlot.segmentIndex) this.topSlot?.hit();
    });
  }

  /** Emote di un giocatore: salto + fumetto sopra la sua birra (+ suono se `sound`). */
  emote(playerId, emote, sound = true) {
    this.stage.emote(playerId, emote, sound);
  }

  /** Eventi istantanei dall'host: esultanze delle birre. */
  handleEvent(e) {
    if (e.type === 'pint' || e.type === 'top_slot_hit' || e.type === 'bounty_claimed') this.stage.celebrate(e.playerId);
    if (e.type === 'splash') this.stage.celebrate(e.playerId);
    if (e.type === 'award') for (const id of e.award.winners) this.stage.celebrate(id);
    if (e.type === 'game_over' && e.winnerId) this.stage.celebrate(e.winnerId);
  }
}

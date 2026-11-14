import { PHASE } from '../protocol.js';

/**
 * Collega gli snapshot/eventi dell'host a uno StageRenderer. Stessa logica per:
 *  - lo schermo Salotto (eventi locali di HostCore)
 *  - i telefoni in Pocket (messaggi di rete)
 * Gli spin sono deduplicati per plan.id: arrivano sia come evento SPIN_START sia dentro STATE
 * (quest'ultimo serve a chi si collega/ricollega a ruota già in movimento).
 */
export class StageSync {
  #segmentsKey = '';
  #playingId = null;
  #lastFinishedId = 0;
  #lastResultId = 0;

  constructor(stage) {
    this.stage = stage;
  }

  applyState(s) {
    const key = JSON.stringify(s.wheel.segments);
    if (key !== this.#segmentsKey) {
      this.#segmentsKey = key;
      this.stage.setSegments(s.wheel.segments);
    }

    this.stage.setPlayers(s.players, s.turnPlayerId, s.phase);

    // Esultanza dell'avatar quando vince monete
    const result = s.lastResult;
    if (s.phase === PHASE.RESULT && result && result.spinId !== this.#lastResultId) {
      this.#lastResultId = result.spinId;
      if (result.coinsDelta > 0 && result.playerId) this.stage.celebrate(result.playerId);
    }

    if (s.spin) {
      this.playSpin(s.spin.plan, s.spin.elapsed);
      return;
    }
    if (this.#playingId !== null) return; // la nostra animazione sta ancora finendo

    this.stage.setAngle(s.wheel.angle);
    if (s.phase === PHASE.RESULT && result) {
      this.stage.setHighlight(result.segmentIndex);
    } else if (s.phase === PHASE.IDLE) {
      this.stage.setHighlight(-1);
      this.stage.setLights('idle');
    }
  }

  playSpin(plan, elapsed = 0) {
    if (plan.id === this.#playingId || plan.id <= this.#lastFinishedId) return;
    this.#playingId = plan.id;
    this.stage.playSpin(plan, elapsed).then(() => {
      if (this.#playingId === plan.id) {
        this.#playingId = null;
        this.#lastFinishedId = plan.id;
      }
    });
  }
}

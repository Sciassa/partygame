import { PHASE } from '../protocol.js';

/**
 * Collega gli snapshot/eventi dell'host a un WheelRenderer. Stessa logica per:
 *  - lo schermo Salotto (eventi locali di HostCore)
 *  - i telefoni in Pocket (messaggi di rete)
 * Gli spin sono deduplicati per plan.id: arrivano sia come evento SPIN_START sia dentro STATE
 * (quest'ultimo serve a chi si collega/ricollega a ruota già in movimento).
 */
export class WheelSync {
  #segmentsKey = '';
  #playingId = null;
  #lastFinishedId = 0;

  constructor(renderer) {
    this.renderer = renderer;
  }

  applyState(s) {
    const key = JSON.stringify(s.wheel.segments);
    if (key !== this.#segmentsKey) {
      this.#segmentsKey = key;
      this.renderer.setSegments(s.wheel.segments);
    }

    if (s.spin) {
      this.playSpin(s.spin.plan, s.spin.elapsed);
      return;
    }
    if (this.#playingId !== null) return; // la nostra animazione sta ancora finendo

    this.renderer.setAngle(s.wheel.angle);
    if (s.phase === PHASE.RESULT && s.lastResult) {
      this.renderer.setHighlight(s.lastResult.segmentIndex);
    } else if (s.phase === PHASE.IDLE) {
      this.renderer.setHighlight(-1);
      this.renderer.setLights('idle');
    }
  }

  playSpin(plan, elapsed = 0) {
    if (plan.id === this.#playingId || plan.id <= this.#lastFinishedId) return;
    this.#playingId = plan.id;
    this.renderer.playSpin(plan, elapsed).then(() => {
      if (this.#playingId === plan.id) {
        this.#playingId = null;
        this.#lastFinishedId = plan.id;
      }
    });
  }
}

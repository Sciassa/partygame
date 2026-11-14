/**
 * SoundEngine — tutti i suoni del gioco sintetizzati con la Web Audio API.
 * Zero file da scaricare: ogni effetto è costruito con oscillatori, rumore bianco e filtri.
 *
 * Catena audio:  sorgenti → (filtri/inviluppi per effetto) → master (gain) → compressore → uscita
 * Il compressore evita che 12 telefoni che brindano insieme saturino gli altoparlanti della TV.
 *
 * Sblocco: i browser (soprattutto iOS Safari) avviano l'AudioContext solo dopo un gesto
 * dell'utente. Al primo click/tocco/tasto il motore si crea e si sblocca da solo; prima di allora
 * ogni play*() è un no-op silenzioso (nessun errore, nessuna coda di suoni "in ritardo").
 */

type Wave = OscillatorType;

interface ToneOptions {
  freq: number;
  duration: number;
  type?: Wave;
  gain?: number;
  slideTo?: number;
  delay?: number;
  attack?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number; slideTo?: number };
}

interface NoiseOptions {
  duration: number;
  gain?: number;
  delay?: number;
  attack?: number;
  filter: { type: BiquadFilterType; freq: number; q?: number; slideTo?: number };
  playbackRate?: number;
}

type AudioContextCtor = typeof AudioContext;

const MUTE_KEY = 'ruota.muted';

class SoundEngineImpl {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #noise: AudioBuffer | null = null;
  #lastClack = 0;
  #muted = false;
  #installed = false;

  constructor() {
    try {
      this.#muted = globalThis.localStorage?.getItem(MUTE_KEY) === '1';
    } catch {
      this.#muted = false;
    }
  }

  /** Aggancia lo sblocco automatico al primo gesto dell'utente (idempotente). */
  install(): void {
    if (this.#installed || typeof window === 'undefined') return;
    this.#installed = true;
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'touchend', 'keydown', 'click'] as const) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    // iOS sospende il contesto quando l'app va in background: al ritorno lo riprendiamo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.#ctx?.state === 'suspended') void this.#ctx.resume().catch(() => {});
    });
  }

  /** Crea/riprende l'AudioContext. Va chiamato dentro un gestore di gesto utente. */
  unlock(): void {
    try {
      if (!this.#ctx) {
        const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor({ latencyHint: 'interactive' });
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 12;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;
        const master = ctx.createGain();
        master.gain.value = this.#muted ? 0 : 0.9;
        master.connect(compressor).connect(ctx.destination);
        this.#ctx = ctx;
        this.#master = master;
        this.#noise = this.#makeNoise(ctx);
      }
      if (this.#ctx.state === 'suspended') void this.#ctx.resume().catch(() => {});
    } catch {
      this.#ctx = null;
      this.#master = null;
    }
  }

  get ready(): boolean {
    return this.#ctx?.state === 'running';
  }

  get muted(): boolean {
    return this.#muted;
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    try {
      globalThis.localStorage?.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* storage non disponibile: pazienza */
    }
    if (this.#master && this.#ctx) this.#master.gain.setTargetAtTime(muted ? 0 : 0.9, this.#ctx.currentTime, 0.02);
  }

  // ================================================================== effetti di gioco

  /**
   * "Clack" del puntatore di plastica che sbatte su un piolo: un colpo di rumore bianco
   * filtrato passa-banda a ~950 Hz, inviluppo esponenziale di 35 ms.
   * Più la ruota è veloce, più il clack è acuto e secco (e un filo più forte).
   * @param speed velocità angolare della ruota in rad/s
   */
  playPegClack(speed: number): void {
    const ctx = this.#live();
    if (!ctx) return;
    const now = performance.now();
    // a velocità altissime i pioli si susseguono a < 20 ms: oltre è solo rumore
    if (now - this.#lastClack < 18) return;
    this.#lastClack = now;
    const s = Math.max(0, Math.min(1, Math.abs(speed) / 22));
    this.#noiseBurst({
      duration: 0.035,
      gain: 0.32 + s * 0.28,
      attack: 0.0015,
      playbackRate: 0.85 + s * 0.6,
      filter: { type: 'bandpass', freq: 950 * (0.85 + s * 0.7), q: 6 },
    });
    // corpo legnoso del colpo: un "tock" sinusoidale brevissimo
    this.#tone({ freq: 420 + s * 260, slideTo: 260, duration: 0.03, type: 'sine', gain: 0.12 + s * 0.08, attack: 0.001 });
  }

  /**
   * Un adesivo si attiva sullo spicchio.
   *  - bonus: arpeggio ascendente C5-E5-G5-C6 a onda triangolare (scintillante)
   *  - trappola: discesa cromatica a dente di sega con filtro passa-basso che si chiude 180→70 Hz
   */
  playStickerTrigger(isTrap: boolean): void {
    if (!this.#live()) return;
    if (!isTrap) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        this.#tone({ freq, duration: 0.22, type: 'triangle', gain: 0.2, delay: i * 0.075, attack: 0.004 });
        this.#tone({ freq: freq * 2, duration: 0.12, type: 'sine', gain: 0.05, delay: i * 0.075 + 0.01 });
      });
      return;
    }
    // discesa cromatica: il passa-basso si chiude nota dopo nota da 180 a 70 Hz (suono "che affonda")
    const start = 146.83; // Re3 → giù di semitono in semitono
    for (let i = 0; i < 6; i++) {
      const freq = start * 2 ** (-i / 12);
      const cutoff = 180 - 22 * i;
      this.#tone({
        freq,
        duration: 0.16,
        type: 'sawtooth',
        gain: 0.42,
        delay: i * 0.09,
        attack: 0.005,
        filter: { type: 'lowpass', freq: cutoff * 2.2, q: 5, slideTo: cutoff },
      });
    }
    // colpo sordo finale
    this.#tone({ freq: 70, slideTo: 40, duration: 0.45, type: 'sawtooth', gain: 0.22, delay: 0.55, filter: { type: 'lowpass', freq: 180, slideTo: 70, q: 2 } });
  }

  /** Emote CIN CIN: rumore bianco filtrato (il "clink" del vetro) + parziali a 1800/2400 Hz a lungo decadimento. */
  playCheersEmote(): void {
    if (!this.#live()) return;
    this.#noiseBurst({ duration: 0.06, gain: 0.35, attack: 0.001, filter: { type: 'highpass', freq: 3200, q: 0.7 } });
    this.#tone({ freq: 1800, duration: 0.9, type: 'sine', gain: 0.16, attack: 0.002 });
    this.#tone({ freq: 2400, duration: 0.7, type: 'sine', gain: 0.11, attack: 0.002 });
    this.#tone({ freq: 3170, duration: 0.4, type: 'sine', gain: 0.05, attack: 0.002 });
    // secondo bicchiere, un attimo dopo e leggermente stonato
    this.#noiseBurst({ duration: 0.05, gain: 0.25, delay: 0.09, attack: 0.001, filter: { type: 'highpass', freq: 3600, q: 0.7 } });
    this.#tone({ freq: 1870, duration: 0.8, type: 'sine', gain: 0.12, delay: 0.09, attack: 0.002 });
    this.#tone({ freq: 2490, duration: 0.6, type: 'sine', gain: 0.08, delay: 0.09, attack: 0.002 });
  }

  /** Emote AHAHAH: tre "ha" con formante vocale (onda quadra filtrata, pitch che scende). */
  playLaughEmote(): void {
    if (!this.#live()) return;
    for (let i = 0; i < 4; i++) {
      const base = 340 - i * 22;
      this.#tone({ freq: base, slideTo: base * 0.82, duration: 0.11, type: 'square', gain: 0.14, delay: i * 0.13, attack: 0.008, filter: { type: 'bandpass', freq: 900, q: 3 } });
      this.#noiseBurst({ duration: 0.05, gain: 0.07, delay: i * 0.13, filter: { type: 'bandpass', freq: 1800, q: 2 } });
    }
  }

  /** Emote BUUU: pernacchia bassa, dente di sega in passa-basso che oscilla. */
  playBooEmote(): void {
    if (!this.#live()) return;
    this.#tone({ freq: 150, slideTo: 95, duration: 0.85, type: 'sawtooth', gain: 0.22, attack: 0.05, filter: { type: 'lowpass', freq: 600, slideTo: 220, q: 6 } });
    this.#tone({ freq: 155, slideTo: 98, duration: 0.85, type: 'sawtooth', gain: 0.15, attack: 0.05, filter: { type: 'lowpass', freq: 520, slideTo: 200, q: 6 } });
  }

  /** Emote DAJE (fuoco): fruscio che sale + accordo maggiore brillante. */
  playFireEmote(): void {
    if (!this.#live()) return;
    this.#noiseBurst({ duration: 0.5, gain: 0.18, attack: 0.15, filter: { type: 'bandpass', freq: 600, slideTo: 4200, q: 1.2 } });
    [392, 493.88, 587.33].forEach((freq, i) => this.#tone({ freq, duration: 0.45, type: 'sawtooth', gain: 0.07, delay: 0.32 + i * 0.02, filter: { type: 'lowpass', freq: 2400, q: 1 } }));
  }

  /** Buzzer di errore / tempo scaduto. */
  playBuzzer(): void {
    if (!this.#live()) return;
    this.#tone({ freq: 110, duration: 0.55, type: 'square', gain: 0.16, attack: 0.005, filter: { type: 'lowpass', freq: 900, q: 1 } });
    this.#tone({ freq: 116.5, duration: 0.55, type: 'sawtooth', gain: 0.12, attack: 0.005, filter: { type: 'lowpass', freq: 700, q: 1 } });
  }

  /** Lancio della ruota: "whoosh" di rumore che sale + strappo. */
  playSpinStart(): void {
    if (!this.#live()) return;
    this.#noiseBurst({ duration: 0.45, gain: 0.3, attack: 0.04, filter: { type: 'bandpass', freq: 300, slideTo: 2600, q: 1.4 } });
    this.#tone({ freq: 180, slideTo: 620, duration: 0.3, type: 'triangle', gain: 0.1 });
  }

  /** Vincita / jackpot: fanfara breve. */
  playWin(): void {
    if (!this.#live()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.#tone({ freq, duration: 0.2, type: 'square', gain: 0.08, delay: i * 0.09, filter: { type: 'lowpass', freq: 3500 } });
      this.#tone({ freq: freq / 2, duration: 0.2, type: 'triangle', gain: 0.08, delay: i * 0.09 });
    });
    this.#tone({ freq: 1046.5, duration: 0.6, type: 'triangle', gain: 0.12, delay: 0.36 });
  }

  /** Monete: "cling" metallico (due sinusoidi inarmoniche). */
  playCoin(): void {
    if (!this.#live()) return;
    this.#tone({ freq: 1975, duration: 0.09, type: 'square', gain: 0.06, filter: { type: 'lowpass', freq: 5000 } });
    this.#tone({ freq: 2637, duration: 0.35, type: 'square', gain: 0.06, delay: 0.07, filter: { type: 'lowpass', freq: 5000 } });
  }

  /** Un giocatore entra nella stanza. */
  playJoin(): void {
    if (!this.#live()) return;
    this.#tone({ freq: 660, duration: 0.09, type: 'sine', gain: 0.16 });
    this.#tone({ freq: 990, duration: 0.12, type: 'sine', gain: 0.16, delay: 0.08 });
  }

  /** Movimento sospetto al bancone (Sottobanco): due note furtive in pizzicato. */
  playSneaky(): void {
    if (!this.#live()) return;
    [196, 233.08, 196, 293.66].forEach((freq, i) => this.#tone({ freq, duration: 0.09, type: 'triangle', gain: 0.18, delay: i * 0.14, filter: { type: 'lowpass', freq: 1200 } }));
  }

  /** Splash (Birra Analcolica lanciata): rumore che si chiude verso il basso. */
  playSplash(): void {
    if (!this.#live()) return;
    this.#noiseBurst({ duration: 0.5, gain: 0.35, attack: 0.005, filter: { type: 'lowpass', freq: 5000, slideTo: 400, q: 0.8 } });
    for (let i = 0; i < 5; i++) this.#tone({ freq: 900 + Math.random() * 900, slideTo: 300, duration: 0.06, type: 'sine', gain: 0.05, delay: 0.08 + i * 0.05 });
  }

  /** Shot bevuto: glu-glu + "ahh". */
  playShot(): void {
    if (!this.#live()) return;
    for (let i = 0; i < 3; i++) this.#tone({ freq: 220 - i * 25, slideTo: 140, duration: 0.07, type: 'sine', gain: 0.2, delay: i * 0.1 });
    this.#noiseBurst({ duration: 0.35, gain: 0.12, delay: 0.32, attack: 0.03, filter: { type: 'bandpass', freq: 1200, slideTo: 700, q: 1.5 } });
  }

  /** Bolla di schiuma che scoppia (tap sulle opzioni coperte). */
  playPop(): void {
    if (!this.#live()) return;
    this.#tone({ freq: 500, slideTo: 1400, duration: 0.05, type: 'sine', gain: 0.2, attack: 0.001 });
    this.#noiseBurst({ duration: 0.025, gain: 0.12, filter: { type: 'highpass', freq: 2000 } });
  }

  // ================================================================== primitive

  #live(): AudioContext | null {
    const ctx = this.#ctx;
    if (!ctx || ctx.state !== 'running' || this.#muted) return null;
    return ctx;
  }

  #makeNoise(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 1.0);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  #envelope(ctx: AudioContext, t0: number, attack: number, duration: number, peak: number): GainNode {
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.001, attack));
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    return amp;
  }

  #filter(ctx: AudioContext, t0: number, duration: number, spec: NonNullable<ToneOptions['filter']>): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = spec.type;
    f.frequency.setValueAtTime(spec.freq, t0);
    if (spec.slideTo) f.frequency.exponentialRampToValueAtTime(spec.slideTo, t0 + duration);
    f.Q.value = spec.q ?? 1;
    return f;
  }

  #tone({ freq, duration, type = 'sine', gain = 0.1, slideTo, delay = 0, attack = 0.004, filter }: ToneOptions): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    const amp = this.#envelope(ctx, t0, attack, duration, gain);
    let node: AudioNode = osc;
    if (filter) node = node.connect(this.#filter(ctx, t0, duration, filter));
    node.connect(amp).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  #noiseBurst({ duration, gain = 0.2, delay = 0, attack = 0.002, filter, playbackRate = 1 }: NoiseOptions): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master || !this.#noise) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.playbackRate.value = playbackRate;
    const amp = this.#envelope(ctx, t0, attack, duration, gain);
    src.connect(this.#filter(ctx, t0, duration, filter)).connect(amp).connect(master);
    // offset casuale nel buffer: ogni colpo suona un filo diverso
    src.start(t0, Math.random() * 0.8, duration + 0.03);
  }
}

/** Istanza unica condivisa da tutta l'app. */
export const SoundEngine = new SoundEngineImpl();
export type { SoundEngineImpl };

/** Suoni legati alle emote: usati sia dal telefono che dalla TV. */
export const EMOTE_SOUNDS: Record<string, () => void> = {
  cheers: () => SoundEngine.playCheersEmote(),
  laugh: () => SoundEngine.playLaughEmote(),
  boo: () => SoundEngine.playBooEmote(),
  fire: () => SoundEngine.playFireEmote(),
};

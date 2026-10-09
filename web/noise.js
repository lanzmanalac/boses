// noise.js — owned by P2. Pure logic: no DOM, no Web Audio, runs in Node for tests.
//
// Decides whether a stretch of audio is worth transcribing at all. WhisperEngine
// (asr.js) does no noise gating, so this file is the only thing standing between
// a loud room and a fluent, invented caption. Principle: denoise gently, gate hard.
//
// Guards, cheapest first (Boses.md §7 Step 0, ARCHITECTURE.md §3.1):
//   1. Room noise-floor calibration — thresholds are relative to *this* room.
//   2. Gentle high-pass (~100 Hz) — removes fan/aircon rumble.
//   3. Minimum duration — too short to be a word -> 'too_short', decoder skipped.
//   4. SNR gate — speech not clearly above the floor -> 'snr_below_threshold',
//      decoder skipped.
//   5. Steady-energy guard — loud but unmodulated (fan, rain, hum) is noise, not
//      speech -> also 'snr_below_threshold'.
// Hallucination-loop suppression runs after decoding, in asr.js.

/** @typedef {import('../contracts.ts').GapReason} GapReason */

/**
 * Output of capture, input to engine.transcribe(seg.pcm, ...).
 * Mirrors RawSegment in ARCHITECTURE.md §3.1.
 * @typedef {object} RawSegment
 * @property {Float32Array} pcm      mono, 16 kHz, high-passed
 * @property {number} startSec       seconds from session start
 * @property {number} endSec
 * @property {number} snrDb          speech level above the calibrated room floor
 * @property {GapReason['kind']} [reason]  set when a guard rejected it; do not decode
 */

export const SAMPLE_RATE = 16000;
export const FRAME = 320; // 20 ms

export const DEFAULTS = Object.freeze({
  snrThresholdDb: 16,       // measured: all 13 real lines pass; 10 dB mix (ASR ~100% wrong) mostly gated; babble 7-11 dB
  startMarginDb: 9,         // frame this far above the floor starts an utterance
  stopMarginDb: 5,          // ...and below this ends it (hysteresis)
  pauseDropDb: 22,          // ...or this far below the utterance's own peak (quiet rooms: breath/echo
                            //    keep pauses above floor+5, which forced 12 s cuts on the real takes).
                            //    22 dB: captions every ~4-6 s; whisper-base WER clean 57% (47% at 12 s cuts), noisy 58% (same)
  hangoverSec: 0.5,         // measured: 0.35 cut lines at commas; 0.5 cut whisper-base WER 62%->46% (clean)
  preRollSec: 0.2,          // audio kept before onset so first syllables aren't clipped
  postRollSec: 0.15,
  minSpeechSec: 0.3,        // shorter -> too_short
  maxSegmentSec: 12,        // force-cut long speech so captions keep flowing
  floorWindowSec: 5,        // noise floor = low percentile of the last N seconds
  floorPercentile: 0.15,
  calibrationSec: 1.0,      // first second sets the floor; ask the room for quiet
  steadyStdDb: 3,           // frame-level std below this = unmodulated noise
  highPassHz: 100,
});

/** @param {Float32Array} x */
export function rmsDb(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, x.length) + 1e-12);
}

/** Second-order high-pass (RBJ cookbook). Stateful; call process() on each chunk. */
export class HighPass {
  constructor(cutoffHz = DEFAULTS.highPassHz, sampleRate = SAMPLE_RATE) {
    const w = (2 * Math.PI * cutoffHz) / sampleRate;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 + c) / 2 / a0;
    this.b1 = -(1 + c) / a0;
    this.b2 = (1 + c) / 2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  /** @param {Float32Array} input @returns {Float32Array} */
  process(input) {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x;
      this.y2 = this.y1; this.y1 = y;
      out[i] = y;
    }
    return out;
  }
}

/**
 * Decide whether a finished utterance should reach the decoder.
 * @param {{ durationSec: number, snrDb: number, frameDbStd: number }} m
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {GapReason['kind'] | undefined}
 */
export function gate(m, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (m.durationSec < o.minSpeechSec) return 'too_short';
  if (m.snrDb < o.snrThresholdDb) return 'snr_below_threshold';
  if (m.durationSec >= 1 && m.frameDbStd < o.steadyStdDb) return 'snr_below_threshold';
  return undefined;
}

/**
 * Streaming voice-activity segmenter. Feed it 16 kHz mono audio in any chunk
 * size; it emits RawSegments as utterances close. Same code runs on the live
 * mic (capture.js) and on WAV files in tests.
 */
export class Segmenter {
  /** @param {Partial<typeof DEFAULTS>} [opts] */
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.hp = new HighPass(this.o.highPassHz);
    /** @type {((seg: RawSegment) => void)[]} */
    this.listeners = [];
    this.pending = new Float32Array(0);
    this.frameIndex = 0;
    /** @type {number[]} */
    this.history = [];            // recent frame dB, for the floor
    this.floorDb = -60;
    this.calibrated = false;
    /** @type {Float32Array[]} */
    this.preRoll = [];
    /** @type {null | { frames: Float32Array[], db: number[], startFrame: number, quiet: number }} */
    this.active = null;
    this.levelDb = -90;
    this.lastSnrDb = null;
  }

  /** @param {(seg: RawSegment) => void} cb */
  onSegment(cb) { this.listeners.push(cb); }

  /** @param {Float32Array} chunk 16 kHz mono */
  push(chunk) {
    const filtered = this.hp.process(chunk);
    const buf = new Float32Array(this.pending.length + filtered.length);
    buf.set(this.pending); buf.set(filtered, this.pending.length);
    let i = 0;
    for (; i + FRAME <= buf.length; i += FRAME) this._frame(buf.subarray(i, i + FRAME).slice());
    this.pending = buf.slice(i);
  }

  /** Close any open utterance (call on stop). */
  flush() {
    if (this.active) this._close();
  }

  /** Live numbers for the signal-quality HUD. */
  quality() {
    const live = this.active ? this.levelDb - this.floorDb : null;
    return {
      snrDb: live ?? this.lastSnrDb ?? undefined,
      floorDb: this.floorDb,
      levelDb: this.levelDb,
      speaking: Boolean(this.active),
      calibrated: this.calibrated,
    };
  }

  /** @param {Float32Array} f */
  _frame(f) {
    const o = this.o;
    const db = rmsDb(f);
    this.levelDb = 0.7 * this.levelDb + 0.3 * db;
    this.frameIndex++;

    const framesPerSec = SAMPLE_RATE / FRAME;
    this.history.push(db);
    if (this.history.length > o.floorWindowSec * framesPerSec) this.history.shift();
    if (!this.calibrated) {
      if (this.frameIndex >= o.calibrationSec * framesPerSec) this.calibrated = true;
      this.floorDb = percentile(this.history, 0.5);
      this._remember(f);
      return; // no utterances during calibration
    }
    if (!this.active) this.floorDb = percentile(this.history, o.floorPercentile);

    if (!this.active) {
      if (db > this.floorDb + o.startMarginDb) {
        this.active = { frames: [...this.preRoll], db: [db], startFrame: this.frameIndex - 1 - this.preRoll.length, quiet: 0 };
        this.active.frames.push(f);
        this.preRoll = [];
      } else {
        this._remember(f);
      }
      return;
    }

    const a = this.active;
    a.frames.push(f);
    a.db.push(db);
    a.peak = Math.max(a.peak ?? -Infinity, db);
    const pause = db < this.floorDb + o.stopMarginDb || db < a.peak - o.pauseDropDb;
    a.quiet = pause ? a.quiet + 1 : 0;
    const durSec = a.frames.length / framesPerSec;
    if (a.quiet >= o.hangoverSec * framesPerSec) this._close();
    else if (durSec >= o.maxSegmentSec) this._forceCut();
  }

  /**
   * Speech ran past maxSegmentSec with no real pause. Cut at the quietest
   * moment of the last 1.5 s (between words, not through one) and carry the
   * remainder straight into the next utterance.
   */
  _forceCut() {
    const a = /** @type {NonNullable<Segmenter['active']>} */ (this.active);
    const look = Math.round(1.5 * SAMPLE_RATE / FRAME);
    const off = a.frames.length - a.db.length; // pre-roll frames have no dB entry
    let best = a.db.length - 1;
    let min = Infinity;
    for (let i = Math.max(1, a.db.length - look); i < a.db.length - 1; i++) {
      const v = (a.db[i - 1] + a.db[i] + a.db[i + 1]) / 3;
      if (v < min) { min = v; best = i; }
    }
    const tail = { frames: a.frames.slice(off + best), db: a.db.slice(best), startFrame: a.startFrame + off + best, quiet: 0 };
    a.frames = a.frames.slice(0, off + best);
    a.db = a.db.slice(0, best);
    a.quiet = 0;
    this._close();
    this.active = tail;
  }

  /** @param {Float32Array} f */
  _remember(f) {
    this.preRoll.push(f);
    const keep = Math.round(this.o.preRollSec * SAMPLE_RATE / FRAME);
    while (this.preRoll.length > keep) this.preRoll.shift();
  }

  _close() {
    const o = this.o;
    const a = /** @type {NonNullable<Segmenter['active']>} */ (this.active);
    this.active = null;
    const framesPerSec = SAMPLE_RATE / FRAME;
    // Trim trailing hangover silence but keep a short post-roll.
    const trim = Math.max(0, a.quiet - Math.round(o.postRollSec * framesPerSec));
    const frames = a.frames.slice(0, a.frames.length - trim);
    const speechDb = a.db.slice(0, Math.max(1, a.db.length - a.quiet));

    const pcm = new Float32Array(frames.length * FRAME);
    frames.forEach((fr, k) => pcm.set(fr, k * FRAME));
    const startSec = Math.max(0, a.startFrame) / framesPerSec;
    const durationSec = speechDb.length / framesPerSec;

    // Speech level: mean power of the louder half of frames (syllable nuclei).
    const loud = [...speechDb].sort((x, y) => y - x).slice(0, Math.max(1, Math.ceil(speechDb.length / 2)));
    const levelDb = 10 * Math.log10(loud.reduce((s, d) => s + 10 ** (d / 10), 0) / loud.length);
    const snrDb = round1(levelDb - this.floorDb);
    const frameDbStd = std(speechDb);

    /** @type {RawSegment} */
    const seg = { pcm, startSec: round2(startSec), endSec: round2(startSec + pcm.length / SAMPLE_RATE), snrDb };
    const reason = gate({ durationSec, snrDb, frameDbStd }, o);
    if (reason) seg.reason = reason;
    this.lastSnrDb = snrDb;
    for (const cb of this.listeners) cb(seg);
  }
}

/** @param {number[]} xs @param {number} p */
function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
/** @param {number[]} xs */
function std(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

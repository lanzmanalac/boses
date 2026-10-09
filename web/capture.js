// capture.js — owned by P2. The microphone side of the noise budget.
//
// Mic -> 16 kHz mono -> Segmenter (noise.js) -> RawSegment. Gated segments never
// reach the decoder; they become gaps here. connectCapture() turns a capture +
// an AsrEngine into the { onSegment } shape index.html's streamSegments() reads.
//
// The built-in mic is the default and the demo path; no special hardware assumed.

import { Segmenter, SAMPLE_RATE, DEFAULTS } from './noise.js';

/** @typedef {import('./noise.js').RawSegment} RawSegment */
/** @typedef {import('../contracts.ts').AsrEngine} AsrEngine */
/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */

// Runs on the audio thread: batches 128-sample render quanta into ~2k-sample
// posts. Inlined as a Blob so there is no extra file to precache for offline.
const TAP_WORKLET = `
class BosesTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('boses-tap', BosesTap);
`;

export class MicCapture {
  /** @param {Partial<typeof DEFAULTS>} [opts] */
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.segmenter = new Segmenter(this.opts);
    /** @type {MediaStream | null} */ this.stream = null;
    /** @type {AudioContext | null} */ this.ctx = null;
    /** @type {AudioWorkletNode | null} */ this.node = null;
    this.resampler = null;
    this.capturing = false;
    /** Every segment the gate decided on, for tracing a missing phrase to capture vs. ASR. */
    this.log = [];
    this.startedAt = null;
    this.segmenter.onSegment((seg) => this.log.push({
      at: new Date().toISOString(),
      startSec: seg.startSec, endSec: seg.endSec,
      durSec: Math.round((seg.endSec - seg.startSec) * 100) / 100,
      snrDb: seg.snrDb,
      result: seg.reason ?? 'sent_to_asr',
      floorDb: Math.round(this.segmenter.floorDb * 10) / 10,
    }));
  }

  /** Ask for the mic and start segmenting. Rejects if permission is denied. */
  async start() {
    if (this.capturing) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot open the microphone (needs https or localhost).');
    }
    // Browser DSP off: AGC pumps noise up between words and suppression smears
    // syllables. We denoise gently ourselves and gate hard.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    // Prefer a 16 kHz context (the browser resamples with proper filtering).
    // Firefox throws when the mic's rate differs from the context's, and some
    // browsers reject the option: fall back to the device rate + Downsampler.
    let source;
    for (const opts of [{ sampleRate: SAMPLE_RATE }, undefined]) {
      let ctx = null;
      try {
        ctx = new AudioContext(opts);
        source = ctx.createMediaStreamSource(this.stream);
        this.ctx = ctx;
        break;
      } catch (err) {
        await ctx?.close?.().catch(() => {});
        if (!opts) { this._release(); throw err; }
      }
    }
    if (this.ctx.sampleRate !== SAMPLE_RATE) this.resampler = new Downsampler(this.ctx.sampleRate, SAMPLE_RATE);
    // iOS Safari often starts suspended (the permission prompt breaks the user
    // gesture); a suspended context delivers no audio at all.
    if (this.ctx.state === 'suspended') await this.ctx.resume?.();

    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
    try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }

    this.node = new AudioWorkletNode(this.ctx, 'boses-tap');
    this.node.port.onmessage = (e) => {
      const chunk = this.resampler ? this.resampler.process(e.data) : e.data;
      this.segmenter.push(chunk);
    };
    source.connect(this.node); // not connected to destination: no echo through speakers
    this.capturing = true;
    this.startedAt = new Date().toISOString();
  }

  /** @param {(seg: RawSegment) => void} cb */
  onSegment(cb) { this.segmenter.onSegment(cb); }

  /** Drop the mic if start() fails part-way, so the browser's recording light goes off. */
  _release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  async stop() {
    if (!this.capturing) return;
    this.capturing = false;
    this.segmenter.flush();
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.node = null; this.stream = null; this.ctx = null;
  }

  /**
   * Per-segment gate log plus the settings and device it ran with. Hand this to
   * P1/P4 after a device test: a missing phrase is either 'gap' here (capture)
   * or 'sent_to_asr' with wrong text (recognition).
   */
  exportLog() {
    const track = this.stream?.getAudioTracks?.()[0];
    return {
      startedAt: this.startedAt,
      exportedAt: new Date().toISOString(),
      userAgent: globalThis.navigator?.userAgent,
      microphone: track?.label || null,
      audioContextRate: this.ctx?.sampleRate ?? null,
      resampledInJs: Boolean(this.resampler),
      settings: this.opts,
      segments: [...this.log],
    };
  }

  /** For SignalQualityHUD.render(): { capturing, snrDb } plus floor/level for debugging. */
  signalQuality() {
    return { capturing: this.capturing, ...this.segmenter.quality() };
  }
}

/**
 * Integer-ratio decimator with boxcar averaging as a cheap anti-alias filter;
 * linear interpolation for non-integer ratios. Only used when the browser
 * refuses a 16 kHz AudioContext.
 */
export class Downsampler {
  /** @param {number} fromRate @param {number} toRate */
  constructor(fromRate, toRate) {
    this.ratio = fromRate / toRate;
    this.pos = 0;
    this.carry = new Float32Array(0);
  }

  /** @param {Float32Array} input */
  process(input) {
    const x = new Float32Array(this.carry.length + input.length);
    x.set(this.carry); x.set(input, this.carry.length);
    const r = this.ratio;
    const w = Math.max(1, Math.floor(r));
    const out = [];
    let p = this.pos;
    while (p + w < x.length) {
      const i = Math.floor(p);
      let s = 0;
      for (let k = 0; k < w; k++) s += x[i + k];
      out.push(s / w);
      p += r;
    }
    const consumed = Math.floor(p);
    this.carry = x.slice(consumed);
    this.pos = p - consumed;
    return Float32Array.from(out);
  }
}

/**
 * Glue: capture -> gate -> engine. Returns the { onSegment } shape that
 * index.html's streamSegments() already consumes, so wiring is one line:
 *   for await (const seg of streamSegments(connectCapture(capture, engine, opts)))
 *
 * Gated segments are turned into gap-only TranscriptSegments here and never
 * touch the decoder. Decodes run one at a time, in order.
 *
 * @param {MicCapture | { onSegment(cb: (s: RawSegment) => void): void }} capture
 * @param {AsrEngine} engine
 * @param {{ hotwords?: string[], snrThresholdDb?: number }} [opts]
 */
export function connectCapture(capture, engine, opts = {}) {
  const hotwords = opts.hotwords ?? [];
  const snrThresholdDb = opts.snrThresholdDb ?? DEFAULTS.snrThresholdDb;
  /** @type {((s: TranscriptSegment) => void)[]} */
  const listeners = [];
  let chain = Promise.resolve();
  let n = 0;

  capture.onSegment((raw) => {
    chain = chain.then(async () => {
      let seg;
      if (raw.reason) {
        seg = gapSegment(raw, engine.id, `cap-${++n}`);
      } else {
        try {
          seg = await engine.transcribe(raw.pcm, { startSec: raw.startSec, hotwords, snrDb: raw.snrDb, snrThresholdDb });
        } catch (err) {
          // A failed decode must still be visible: show a gap, never drop the audio silently.
          console.warn('capture -> engine failed', err);
          seg = gapSegment({ ...raw, reason: 'low_confidence' }, engine.id, `cap-${++n}`);
        }
      }
      for (const cb of listeners) {
        try { cb(seg); } catch (err) { console.warn('segment listener failed', err); }
      }
    });
  });

  return { id: engine.id, onSegment: (cb) => { listeners.push(cb); } };
}

/**
 * A segment the decoder never saw: one gap spanning it, reason from the gate.
 * @param {RawSegment} raw @param {TranscriptSegment['engine']} engine @param {string} id
 * @returns {TranscriptSegment}
 */
export function gapSegment(raw, engine, id) {
  return {
    id, start: raw.startSec, end: raw.endSec, snrDb: raw.snrDb,
    words: [],
    gaps: [{ start: raw.startSec, end: raw.endSec, reason: { kind: /** @type {any} */ (raw.reason) } }],
    engine, latencyMs: 0,
  };
}

import { buildHotwordPrompt } from './hotwords.js';

/** @typedef {import('../contracts.ts').AsrEngine} AsrEngine */
/** @typedef {import('../contracts.ts').EngineId} EngineId */
/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */
/** @typedef {import('../contracts.ts').TranscribeOptions} TranscribeOptions */
/** @typedef {import('../contracts.ts').Gap} Gap */

const SAMPLE_RATE = 16000;
const DECODER_WORD_SCORES = false;
const PLACEHOLDER_TIMEOUT_MS = 8000;
const MAX_CRASHES = 1;

/**
 * @typedef {{ text: string, timestamp: [number, number | null] }} PipelineChunk
 * @typedef {
 *   | { kind: 'decoded', text: string, chunks: readonly PipelineChunk[] }
 *   | { kind: 'timeout' }
 *   | { kind: 'failed' }
 *   | { kind: 'too_short' }
 *   | { kind: 'repetition' }
 * } DecodeOutcome
 *
 * @typedef {{
 *   id: string,
 *   pcm: Float32Array,
 *   startSec: number,
 *   snrDb: number,
 *   prompt: string | null,
 *   calledAt: number,
 *   deadlineAt: number,
 *   timer: ReturnType<typeof setTimeout> | null,
 *   promise: Promise<TranscriptSegment>,
 *   resolve: (s: TranscriptSegment) => void,
 *   settled: TranscriptSegment | null,
 * }} Entry
 */

/**
 * @implements {AsrEngine}
 */
export class WhisperEngine {
  constructor() {
    /** @type {EngineId} */
    this.id = 'whisper-wasm';
    /** @type {boolean} */
    this.supportsWordConfidence = DECODER_WORD_SCORES;

    /** @type {Worker | null} */
    this._worker = null;
    /** @type {Promise<void> | null} */
    this._init = null;
    /** @type {Set<(p: number) => void>} */
    this._progress = new Set();
    /** @type {Map<string, Entry>} */
    this._ledger = new Map();
    /** @type {string | null} */
    this._busy = null;
    /** @type {(() => void) | null} */
    this._loadOk = null;
    /** @type {((err: Error) => void) | null} */
    this._loadErr = null;
    this._ready = false;
    this._crashes = 0;
    this._disposed = false;
  }

  /**
   * @param {(p: number) => void} [onProgress]
   * @returns {Promise<void>}
   */
  init(onProgress) {
    if (onProgress) this._progress.add(onProgress);
    if (this._disposed) this._disposed = false;
    if (this._init) return this._init;
    this._init = this._spawn();
    return this._init;
  }

  /**
   * @param {Float32Array} pcm
   * @param {TranscribeOptions} opts
   * @returns {Promise<TranscriptSegment>}
   */
  transcribe(pcm, opts) {
    assertUtterance(pcm, opts);
    const startSec = opts.startSec;
    const snrDb = opts.snrDb;
    const prompt = buildHotwordPrompt(opts.hotwords ?? []);
    const id = ledgerKey(startSec, pcm, prompt);
    const existing = this._ledger.get(id);
    if (existing) return existing.promise;

    const copy = new Float32Array(pcm);
    const now = performance.now();
    const audioSec = copy.length / SAMPLE_RATE;
    const budget = budgetMs(audioSec);
    /** @type {Entry} */
    const entry = {
      id,
      pcm: copy,
      startSec,
      snrDb,
      prompt,
      calledAt: now,
      deadlineAt: now + budget,
      timer: null,
      promise: /** @type {Promise<TranscriptSegment>} */ (null),
      resolve: () => {},
      settled: null,
    };
    entry.promise = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    this._ledger.set(id, entry);
    entry.timer = setTimeout(() => this._onTimeout(id), budget);

    if (copy.length === 0) {
      this._settle(id, { kind: 'too_short' });
      return entry.promise;
    }

    this.init()
      .then(() => this._pump())
      .catch(() => this._settle(id, { kind: 'failed' }));
    return entry.promise;
  }

  /** @returns {Promise<void>} */
  async dispose() {
    this._disposed = true;
    this._killWorker();
    this._init = null;
    this._ready = false;
    this._busy = null;
    for (const e of [...this._ledger.values()]) {
      if (!e.settled) this._settle(e.id, { kind: 'failed' });
    }
  }

  async _spawn() {
    this._killWorker();
    const worker = new Worker(new URL('./asr-worker.js', import.meta.url), {
      type: 'module',
    });
    this._worker = worker;
    worker.onmessage = (ev) => this._onMessage(ev.data);
    worker.onerror = () => this._onCrash();
    const loaded = new Promise((resolve, reject) => {
      this._loadOk = resolve;
      this._loadErr = reject;
    });
    worker.postMessage({ type: 'load' });
    await loaded;
    this._ready = true;
    this._pump();
  }

  /** @param {unknown} msg */
  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const type = /** @type {{ type?: string }} */ (msg).type;
    if (type === 'progress') {
      const p = Number(/** @type {{ p?: number }} */ (msg).p);
      if (Number.isFinite(p)) for (const fn of this._progress) fn(p);
      return;
    }
    if (type === 'loaded') {
      const device = /** @type {{ device?: string }} */ (msg).device;
      this.id = device === 'webgpu' ? 'whisper-webgpu' : 'whisper-wasm';
      this._loadOk?.();
      this._loadOk = null;
      this._loadErr = null;
      return;
    }
    if (type === 'load_failed') {
      this._loadErr?.(new Error('load failed'));
      this._loadOk = null;
      this._loadErr = null;
      this._init = null;
      this._ready = false;
      return;
    }
    if (type === 'decoded' || type === 'decode_failed') {
      const id = String(/** @type {{ id?: string }} */ (msg).id ?? '');
      const entry = this._ledger.get(id);
      if (entry && !entry.settled) {
        if (type === 'decode_failed') this._settle(id, { kind: 'failed' });
        else {
          const text = String(/** @type {{ text?: string }} */ (msg).text ?? '');
          const chunks = Array.isArray(/** @type {{ chunks?: unknown }} */ (msg).chunks)
            ? /** @type {PipelineChunk[]} */ (/** @type {{ chunks: unknown }} */ (msg).chunks)
            : [];
          this._settle(id, decodeFromWorker(text, chunks, entry.prompt));
        }
      }
      if (this._busy === id) {
        this._busy = null;
        this._pump();
      }
    }
  }

  _onCrash() {
    const busy = this._busy;
    this._busy = null;
    this._killWorker();
    this._init = null;
    this._ready = false;
    this._crashes += 1;
    if (busy) this._settle(busy, { kind: 'failed' });
    if (this._crashes > MAX_CRASHES || this._disposed) {
      for (const e of this._ledger.values()) {
        if (!e.settled) this._settle(e.id, { kind: 'failed' });
      }
      return;
    }
    this.init()
      .then(() => this._pump())
      .catch(() => {
        for (const e of this._ledger.values()) {
          if (!e.settled) this._settle(e.id, { kind: 'failed' });
        }
      });
  }

  /** @param {string} id */
  _onTimeout(id) {
    this._settle(id, { kind: 'timeout' });
    if (this._busy !== id) return;
    this._busy = null;
    this._killWorker();
    this._init = null;
    this._ready = false;
    if (this._disposed) return;
    this.init()
      .then(() => this._pump())
      .catch(() => {});
  }

  _pump() {
    if (!this._ready || this._busy || !this._worker) return;
    const now = performance.now();
    for (const e of this._ledger.values()) {
      if (e.settled) continue;
      if (now >= e.deadlineAt) continue;
      this._busy = e.id;
      this._worker.postMessage({
        type: 'decode',
        id: e.id,
        pcm: e.pcm,
        prompt: e.prompt,
      });
      return;
    }
  }

  /**
   * @param {string} id
   * @param {DecodeOutcome} outcome
   */
  _settle(id, outcome) {
    const e = this._ledger.get(id);
    if (!e || e.settled) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    const latencyMs = Math.max(0, Math.round(performance.now() - e.calledAt));
    e.settled = toSegment(e, outcome, this.id, latencyMs);
    e.pcm = new Float32Array(0);
    e.resolve(e.settled);
  }

  _killWorker() {
    const w = this._worker;
    this._worker = null;
    this._ready = false;
    if (!w) return;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
  }
}

/**
 * @param {Float32Array} pcm
 * @param {TranscribeOptions} opts
 */
function assertUtterance(pcm, opts) {
  if (!(pcm instanceof Float32Array)) throw new TypeError('pcm must be Float32Array');
  if (!opts || !Number.isFinite(opts.startSec) || opts.startSec < 0) {
    throw new TypeError('startSec must be a finite number >= 0');
  }
  if (!Number.isFinite(opts.snrDb)) throw new TypeError('snrDb must be a finite number');
}

/**
 * @param {number} startSec
 * @param {Float32Array} pcm
 * @param {string | null} prompt
 * @returns {string}
 */
function ledgerKey(startSec, pcm, prompt) {
  return `pcm:${hashAudio(startSec, pcm)}|prompt:${hashText(prompt ?? '')}`;
}

/**
 * @param {number} startSec
 * @param {Float32Array} pcm
 * @returns {string}
 */
function hashAudio(startSec, pcm) {
  let h = 2166136261;
  const mix = (n) => {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(Math.round(startSec * 1000));
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < pcm.byteLength; i++) mix(view.getUint8(i));
  return `u${Math.round(startSec * 1000).toString(16)}-${h.toString(16)}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

/** @param {number} audioSec */
function budgetMs(audioSec) {
  return Math.max(PLACEHOLDER_TIMEOUT_MS, audioSec * 2000);
}

/**
 * @param {string} text
 * @param {readonly PipelineChunk[]} chunks
 * @param {string | null} prompt
 * @returns {DecodeOutcome}
 */
function decodeFromWorker(text, chunks, prompt) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { kind: 'failed' };
  if (isPromptEcho(trimmed, prompt) || isRepetitionLoop(trimmed, chunks)) {
    return { kind: 'repetition' };
  }
  return { kind: 'decoded', text: trimmed, chunks };
}

/**
 * @param {Entry} e
 * @param {DecodeOutcome} outcome
 * @param {EngineId} engine
 * @param {number} latencyMs
 * @returns {TranscriptSegment}
 */
function toSegment(e, outcome, engine, latencyMs) {
  const start = e.startSec;
  const end = e.startSec + e.pcm.length / SAMPLE_RATE;
  /** @type {Gap[]} */
  let gaps = [];
  if (outcome.kind === 'too_short') {
    gaps = [{ start, end, reason: { kind: 'too_short' } }];
  } else if (outcome.kind === 'repetition') {
    gaps = [{ start, end, reason: { kind: 'repetition_suppressed' } }];
  } else if (outcome.kind === 'decoded') {
    gaps = [
      {
        start,
        end,
        reason: { kind: 'low_confidence', alternatives: [outcome.text] },
      },
    ];
  } else {
    gaps = [{ start, end, reason: { kind: 'low_confidence' } }];
  }
  const seg = {
    id: e.id,
    start,
    end,
    snrDb: e.snrDb,
    words: [],
    gaps,
    engine,
    latencyMs,
  };
  Object.freeze(seg.words);
  Object.freeze(seg.gaps);
  for (const g of gaps) {
    Object.freeze(g);
    Object.freeze(g.reason);
    if (g.reason.alternatives) Object.freeze(g.reason.alternatives);
  }
  return Object.freeze(seg);
}

/**
 * @param {string} text
 * @param {readonly PipelineChunk[]} chunks
 * @returns {boolean}
 */
function isRepetitionLoop(text, chunks) {
  const toks = (chunks && chunks.length
    ? chunks.map((c) => String(c.text ?? '').trim().toLowerCase())
    : text.toLowerCase().split(/\s+/)
  ).filter(Boolean);
  if (toks.length < 3) return false;
  for (let n = 1; n <= 4; n++) {
    if (toks.length < n * 3) continue;
    const unit = toks.slice(toks.length - n).join(' ');
    let repeats = 0;
    for (let i = toks.length; i >= n; i -= n) {
      if (toks.slice(i - n, i).join(' ') === unit) repeats++;
      else break;
    }
    if (repeats >= 3) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {string | null} prompt
 * @returns {boolean}
 */
function isPromptEcho(text, prompt) {
  if (!prompt) return false;
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const words = norm.split(' ').filter(Boolean);
  if (words.length < 3) return false;
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return p.includes(norm);
}

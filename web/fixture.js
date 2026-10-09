// fixture.js — Owner: P4.
// Replay P2's committed lesson fixtures without loading a speech model.
// Fixtures exercise the UI; their authored confidence values are not decoder
// measurements and must not be reported as such.

/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */
/** @typedef {import('../contracts.ts').TranscribeOptions} TranscribeOptions */

const FIXTURE_NAMES = new Set(['clean', 'noisy', 'taglish']);
const GAP_REASONS = new Set([
  'low_confidence',
  'snr_below_threshold',
  'too_short',
  'repetition_suppressed',
]);

/** @param {unknown} value */
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** @param {unknown} value */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Accept either a bare array or `{ segments: [...] }`. P2 can use either
 * wrapper; each segment still has to follow the frozen contract.
 * @param {unknown} data
 * @param {string} source
 * @returns {TranscriptSegment[]}
 */
export function parseFixture(data, source = 'fixture') {
  const rows = Array.isArray(data) ? data : data?.segments;
  if (!Array.isArray(rows)) {
    throw new Error(`${source}: expected an array or an object with a segments array`);
  }

  const ids = new Set();
  return rows.map((row, index) => {
    const label = `${source} segment ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`${label}: expected an object`);
    }
    if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) {
      throw new Error(`${label}: id must be a unique, nonempty string`);
    }
    ids.add(row.id);
    if (!finite(row.start) || !finite(row.end) || row.start < 0 || row.end <= row.start) {
      throw new Error(`${label}: start and end must be valid seconds`);
    }
    if (!finite(row.snrDb)) {
      throw new Error(`${label}: snrDb must be a finite number`);
    }
    if (!finite(row.latencyMs) || row.latencyMs < 0) {
      throw new Error(`${label}: latencyMs must be a nonnegative number`);
    }
    if (!Array.isArray(row.words) || !Array.isArray(row.gaps)) {
      throw new Error(`${label}: words and gaps must be arrays`);
    }

    for (const [wordIndex, word] of row.words.entries()) {
      if (!word || typeof word.text !== 'string' || !word.text.trim() ||
          !finite(word.start) || !finite(word.end) ||
          word.start < row.start || word.end > row.end || word.end <= word.start ||
          !Object.hasOwn(word, 'conf') ||
          (word.conf !== null &&
           (!finite(word.conf) || word.conf < 0 || word.conf > 1))) {
        throw new Error(`${label} word ${wordIndex + 1}: invalid text, timing, or confidence; use explicit null for unverified text`);
      }
    }
    for (const [gapIndex, gap] of row.gaps.entries()) {
      if (!gap || !finite(gap.start) || !finite(gap.end) ||
          gap.start < row.start || gap.end > row.end || gap.end <= gap.start ||
          !gap.reason || !GAP_REASONS.has(gap.reason.kind) ||
          (gap.reason.alternatives !== undefined &&
           (!Array.isArray(gap.reason.alternatives) ||
            !gap.reason.alternatives.every((item) => typeof item === 'string')))) {
        throw new Error(`${label} gap ${gapIndex + 1}: invalid timing or reason`);
      }
      if (row.words.some((word) =>
        Math.max(word.start, gap.start) < Math.min(word.end, gap.end))) {
        throw new Error(`${label} gap ${gapIndex + 1}: overlaps a displayed word`);
      }
    }

    // Preserve optional fixture annotations, but report the adapter actually
    // producing these segments. Never claim fixture output came from Whisper.
    return { ...cloneJson(row), engine: 'fixture' };
  }).sort((a, b) => a.start - b.start);
}

export class FixtureEngine {
  /**
   * @param {{fixture?: 'clean'|'noisy'|'taglish', segments?: unknown,
   *          fetcher?: typeof fetch}} [options]
   */
  constructor({ fixture = 'clean', segments, fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    if (!FIXTURE_NAMES.has(fixture)) {
      throw new Error(`Unknown fixture "${fixture}"; choose clean, noisy, or taglish`);
    }
    this.id = 'fixture';
    // Authored fixture scores do not prove real decoder confidence support.
    this.supportsWordConfidence = false;
    this.fixture = fixture;
    this.source = new URL(`../lessons/fixtures/${fixture}.fixture.json`, import.meta.url);
    this.fetcher = fetcher;
    this.suppliedSegments = segments;
    /** @type {TranscriptSegment[] | null} */
    this.loaded = null;
    this.cursor = 0;
  }

  /** @param {(progress: number) => void} [onProgress] */
  async init(onProgress) {
    if (this.loaded) {
      onProgress?.(1);
      return;
    }
    onProgress?.(0);
    let data = this.suppliedSegments;
    if (data === undefined) {
      if (typeof this.fetcher !== 'function') {
        throw new Error('Fixture fetch is unavailable in this environment');
      }
      let response;
      try {
        response = await this.fetcher(this.source);
      } catch (error) {
        throw new Error(`Could not load ${this.fixture} fixture at ${this.source}`, { cause: error });
      }
      if (!response.ok) {
        throw new Error(`Could not load ${this.fixture} fixture at ${this.source} (HTTP ${response.status})`);
      }
      try {
        data = await response.json();
      } catch (error) {
        throw new Error(`${this.fixture} fixture is not valid JSON`, { cause: error });
      }
    }
    this.loaded = parseFixture(data, this.fixture);
    this.cursor = 0;
    onProgress?.(1);
  }

  /** Replay all segments for P3's fixture-mode caption loop. */
  async segments() {
    await this.init();
    return cloneJson(this.loaded);
  }

  /**
   * Return the next fixture segment through the AsrEngine port. PCM and
   * options are intentionally ignored: this adapter replays recorded data.
   * @param {Float32Array} pcm
   * @param {TranscribeOptions} opts
   * @returns {Promise<TranscriptSegment>}
   */
  async transcribe(pcm, opts) {
    void pcm;
    void opts;
    await this.init();
    if (this.cursor >= this.loaded.length) {
      throw new Error(`${this.fixture} fixture has no more segments to replay`);
    }
    return cloneJson(this.loaded[this.cursor++]);
  }

  async dispose() {
    this.loaded = null;
    this.cursor = 0;
  }
}

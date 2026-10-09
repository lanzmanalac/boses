// confidence.js — Owner: P4.
// P1's current engine provides words and timestamps, not decoder confidence.
// Passing these audio-quality guards means "unverified text shown", never
// "the model is confident". P2 owns SNR measurement and repetition detection;
// this module consumes their results and creates first-class gaps.

/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */
/** @typedef {import('../contracts.ts').CoverageStats} CoverageStats */

export const UNVERIFIED_LABEL =
  'Unverified transcript: audio-quality checks passed; decoder word confidence is unavailable.';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * @typedef {object} GateOptions
 * @property {number} snrThresholdDb P2's measured room threshold.
 * @property {number} minDurationSec P2's minimum plausible utterance duration.
 * @property {boolean} [repetitionDetected] P2's loop detector result.
 * @property {boolean} [supportsWordConfidence] P1's engine capability flag.
 * @property {number} [wordConfidenceThreshold] Required only when the engine
 *   actually supplies decoder-derived word scores.
 */

/** @param {TranscriptSegment} segment @param {string} kind */
function wholeSegmentGap(segment, kind) {
  return {
    ...segment,
    words: [],
    gaps: [{ start: segment.start, end: segment.end, reason: { kind } }],
  };
}

/**
 * Gate one ASR segment before it reaches the caption renderer or storage.
 * The caller must supply P2's measured thresholds. In the no-confidence path,
 * retained words have conf:null so downstream code can identify them as
 * unverified; a passing SNR is not a probability of correctness.
 *
 * @param {TranscriptSegment} segment
 * @param {GateOptions} options
 * @returns {TranscriptSegment}
 */
export function gateSegment(segment, options) {
  if (!segment || !finite(segment.start) || !finite(segment.end) ||
      segment.end <= segment.start || !Array.isArray(segment.words) ||
      !Array.isArray(segment.gaps)) {
    throw new Error('gateSegment requires a timed TranscriptSegment with words and gaps arrays');
  }
  if (!options || !finite(options.snrThresholdDb) ||
      !finite(options.minDurationSec) || options.minDurationSec < 0) {
    throw new Error('gateSegment requires measured snrThresholdDb and minDurationSec');
  }
  if (options.supportsWordConfidence &&
      (!finite(options.wordConfidenceThreshold) ||
       options.wordConfidenceThreshold < 0 || options.wordConfidenceThreshold > 1)) {
    throw new Error('Decoder confidence gating requires a threshold from 0 to 1');
  }

  // Unknown SNR must never silently pass an audio-quality gate.
  if (!finite(segment.snrDb)) {
    throw new Error('Segment is missing a finite SNR estimate');
  }
  if (segment.snrDb < options.snrThresholdDb) {
    return wholeSegmentGap(segment, 'snr_below_threshold');
  }
  if (segment.end - segment.start < options.minDurationSec) {
    return wholeSegmentGap(segment, 'too_short');
  }
  if (options.repetitionDetected) {
    return wholeSegmentGap(segment, 'repetition_suppressed');
  }

  const words = [];
  const gaps = [...segment.gaps];
  for (const word of segment.words) {
    if (!word || typeof word.text !== 'string' || !word.text.trim() ||
        !finite(word.start) || !finite(word.end) ||
        word.start < segment.start || word.end > segment.end ||
        word.end <= word.start) {
      throw new Error(`Invalid word timing or text in segment ${segment.id}`);
    }
    if (options.supportsWordConfidence) {
      if (!finite(word.conf) || word.conf < 0 || word.conf > 1) {
        throw new Error(`Engine claims word confidence but segment ${segment.id} has none`);
      }
      if (word.conf < options.wordConfidenceThreshold) {
        gaps.push({ start: word.start, end: word.end,
          reason: { kind: 'low_confidence' } });
        continue;
      }
      words.push({ ...word });
    } else {
      // Do not forward a fixture score or an accidental placeholder as if it
      // came from the real decoder. The accepted text remains unverified.
      words.push({ ...word, conf: null });
    }
  }
  for (const gap of gaps) {
    if (!gap || !finite(gap.start) || !finite(gap.end) ||
        gap.start < segment.start || gap.end > segment.end ||
        gap.end <= gap.start || !gap.reason?.kind) {
      throw new Error(`Invalid gap in segment ${segment.id}`);
    }
    if (words.some((word) =>
      Math.max(word.start, gap.start) < Math.min(word.end, gap.end))) {
      throw new Error(`A displayed word overlaps a gap in segment ${segment.id}`);
    }
  }
  if (words.length === 0 && gaps.length === 0) {
    return wholeSegmentGap(segment, 'low_confidence');
  }
  return { ...segment, words, gaps: gaps.sort((a, b) => a.start - b.start) };
}

/**
 * Coverage counts displayed word time versus explicit gap time. Under P1's
 * no-confidence engine, the contract's `confidentSec` field means "passed the
 * audio-quality gate". The UI must label this as unverified, not confidence.
 * @param {TranscriptSegment[]} segments
 * @returns {CoverageStats}
 */
export function deriveCoverage(segments) {
  let accepted = 0;
  let uncertain = 0;
  for (const segment of segments ?? []) {
    for (const word of segment.words ?? []) {
      accepted += Math.max(0, word.end - word.start);
    }
    for (const gap of segment.gaps ?? []) {
      uncertain += Math.max(0, gap.end - gap.start);
    }
  }
  const total = accepted + uncertain;
  return {
    totalSec: total,
    confidentSec: accepted,
    uncertainSec: uncertain,
    coverageRatio: total > 0 ? accepted / total : 0,
  };
}

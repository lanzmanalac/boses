import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCoverage, gateSegment, UNVERIFIED_LABEL } from '../web/confidence.js';

const segment = {
  id: 'lesson-1', start: 0, end: 2, snrDb: 16, latencyMs: 120,
  engine: 'whisper-wasm',
  words: [{ text: 'halaman', start: 0, end: 1, conf: null }],
  gaps: [],
};
const checks = { snrThresholdDb: 8, minDurationSec: 0.2,
  supportsWordConfidence: false };

test('passes a quality-gated word as explicitly unverified, without inventing a score', () => {
  const result = gateSegment(segment, checks);
  assert.equal(result.words[0].conf, null);
  assert.deepEqual(result.gaps, []);
  assert.match(UNVERIFIED_LABEL, /Unverified/);
  assert.equal(segment.words[0].conf, null);
});

test('turns noisy, short, and repetition-detected segments into visible gaps', () => {
  const cases = [
    [{ ...segment, snrDb: 4 }, checks, 'snr_below_threshold'],
    [{ ...segment, end: 0.1, words: [] }, checks, 'too_short'],
    [segment, { ...checks, repetitionDetected: true }, 'repetition_suppressed'],
  ];
  for (const [input, options, reason] of cases) {
    const result = gateSegment(input, options);
    assert.equal(result.words.length, 0);
    assert.equal(result.gaps[0].reason.kind, reason);
    assert.equal(result.gaps[0].start, input.start);
    assert.equal(result.gaps[0].end, input.end);
  }
});

test('uses decoder scores only when the engine actually provides them', () => {
  const scored = { ...segment, words: [
    { text: 'halaman', start: 0, end: 1, conf: 0.9 },
    { text: 'unclear', start: 1, end: 2, conf: 0.2 },
  ] };
  const result = gateSegment(scored, { ...checks, supportsWordConfidence: true,
    wordConfidenceThreshold: 0.5 });
  assert.equal(result.words.length, 1);
  assert.equal(result.gaps[0].reason.kind, 'low_confidence');
  assert.equal(gateSegment(scored, checks).words[0].conf, null);
});

test('coverage reflects displayed time and gap time, not model accuracy', () => {
  const noisy = gateSegment({ ...segment, snrDb: 4, start: 2, end: 4,
    words: [{ text: 'unclear', start: 2, end: 3, conf: null }] }, checks);
  const coverage = deriveCoverage([gateSegment(segment, checks), noisy]);
  assert.deepEqual(coverage, {
    totalSec: 3, confidentSec: 1, uncertainSec: 2, coverageRatio: 1 / 3,
  });
});

test('requires measured thresholds and refuses an unknown SNR', () => {
  assert.throws(() => gateSegment(segment, {}), /requires measured/);
  assert.throws(() => gateSegment({ ...segment, snrDb: NaN }, checks), /SNR estimate/);
});

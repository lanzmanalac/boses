// P4 scoring tool checks. These verify the scorer's rules — that it refuses
// fixture numbers, refuses to invent a slice score, and keeps displayed
// coverage separate from raw accuracy. They are not accuracy measurements.

import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTargets, parseGoldLabels, scoreRun, summarizeLatency } from './score-run.mjs';

const gold = parseGoldLabels([
  '0.900000\t4.970000\t[MIX] Okay class, good morning.',
  '5.730000\t10.430000\t[EN] Plants need sunlight and water.',
  '30.800000\t33.300000\t[TL] Kaya mahalaga ang mga halaman.',
].join('\n'));

function run(overrides = {}) {
  return {
    schema: 'boses/run-manifest@1',
    label: 'clean / laptop',
    device: 'Laptop', runtime: 'WebGPU', model: 'Xenova/whisper-tiny', package: '4.3.1',
    gate: { snrThresholdDb: 16, minDurationSec: 0.3, hangoverSec: 0.5 },
    segments: [
      { id: 'a', start: 0.9, end: 4.97, snrDb: 21.4, latencyMs: 800, decodeMs: 640,
        speechPresent: true, raw: { text: 'Okay class good evening' },
        words: [{ text: 'Okay', start: 0.9, end: 1.4, conf: null },
          { text: 'class', start: 1.4, end: 2.1, conf: null }],
        gaps: [] },
      { id: 'b', start: 5.73, end: 10.43, snrDb: 18.2, latencyMs: 1400, decodeMs: 900,
        speechPresent: true, raw: { text: 'Plants need sunlight in water' },
        words: [{ text: 'Plants', start: 5.73, end: 6.2, conf: null }],
        gaps: [] },
      { id: 'c', start: 30.8, end: 33.3, snrDb: 9.1, latencyMs: 60, decodeMs: 0,
        speechPresent: true, raw: { text: '' }, words: [],
        gaps: [{ start: 30.8, end: 33.3, reason: { kind: 'snr_below_threshold' } }] },
    ],
    ...overrides,
  };
}

test('reads P2 label files with their language tags and rejects broken ones', () => {
  assert.equal(gold.length, 3);
  assert.deepEqual(gold.map((span) => span.lang), ['MIX', 'EN', 'TL']);
  assert.equal(gold[2].text, 'Kaya mahalaga ang mga halaman.');
  assert.throws(() => parseGoldLabels('not a label line at all'), /Bad times/);
  assert.throws(() => parseGoldLabels('nonsense'), /Unreadable/);
  assert.throws(() => parseGoldLabels('5 1 [TL] backwards'), /Bad times/);
});

test('scores raw ASR accuracy per slice and keeps coverage in a separate block', () => {
  const report = scoreRun(run(), gold);
  assert.equal(report.rawAsr.status, 'scored');
  assert.equal(report.rawAsr.referenceUnits, 14); // 4 + 5 + 5 gold words
  assert.ok(report.rawAsr.wer > 0, 'the hypothesis differs from the reference');

  assert.equal(report.rawAsrBySlice.TL.status, 'scored');
  assert.equal(report.rawAsrBySlice.TL.wer, 1, 'the gated-out TL span produced nothing');
  assert.equal(report.rawAsrBySlice.EN.substitutions, 1);
  assert.equal(report.rawAsrBySlice.MIX.wer, 0.25); // "morning" decoded as "evening"

  // Coverage describes gate pass time only. It is never an accuracy figure.
  assert.match(report.displayed.note, /not model confidence or accuracy/);
  assert.ok(report.displayed.coverage.confidentSec > 0);
  assert.equal(report.displayed.gapRate, 1 / 3);
  assert.equal(report.displayed.gapSecondsByReason.snr_below_threshold, 2.5);
  assert.equal(report.displayed.wordsShownUnverified, true);
  assert.equal(report.latencyMs.caption.median, 800);
  assert.equal(report.latencyMs.caption.max, 1400);
  assert.equal(report.latencyMs.decode.p95, 900);
});

test('counts a no-speech hallucination only when noise produced displayed words', () => {
  const noiseOnly = run({
    label: 'noise only / laptop',
    segments: [{
      id: 'n', start: 0, end: 3, snrDb: 4, latencyMs: 500, speechPresent: false,
      raw: { text: '' }, words: [], gaps: [],
    }],
  });
  const clean = scoreRun(noiseOnly, []);
  assert.equal(clean.noSpeech.segments, 1);
  assert.equal(clean.noSpeech.hallucinatedSegments, 0);
  assert.equal(clean.rawAsr.status, 'no human reference');

  const hallucinated = scoreRun(run({
    segments: [{ ...noiseOnly.segments[0], snrDb: 20, speechPresent: false,
      raw: { text: 'hello world' },
      words: [{ text: 'hello', start: 0.2, end: 0.9, conf: null }] }],
  }), []);
  assert.equal(hallucinated.noSpeech.hallucinatedSegments, 1);
  assert.equal(hallucinated.noSpeech.detail[0].displayed, 'hello');
});

test('refuses fixture replay as an accuracy result', () => {
  assert.throws(() => scoreRun(run({ runtime: 'fixture' }), gold), /not recognition accuracy/);
  assert.throws(() => scoreRun(run({ engine: 'fixture' }), gold), /not recognition accuracy/);
});

test('reports an unlabeled slice as unlabelled instead of a number', () => {
  const enOnly = parseGoldLabels('5.730000\t10.430000\t[EN] Plants need sunlight and water.');
  const report = scoreRun(run(), enOnly);
  assert.equal(report.rawAsrBySlice.TL.status, 'no human reference');
  assert.equal(report.rawAsrBySlice.TL.wer, undefined);
  assert.equal(report.rawAsrBySlice.EN.status, 'scored');
});

test('routes each observed failure to the lane that can fix it', () => {
  const report = scoreRun(run(), gold);
  const lanes = (issue) => report.diagnostics
    .filter((entry) => entry.issue === issue).map((entry) => entry.lane);
  assert.ok(lanes('raw recognizer text does not match the reference').includes('P1'));
  assert.ok(lanes('clear speech gated out by the capture settings').includes('P2'));
});

test('an agreed target with no measurement is never counted as a pass', () => {
  const report = scoreRun(run({ segments: [] }), []);
  const rows = compareTargets(report, {
    maxWer: 0.3, maxCer: 0.2, maxLatencyP95Ms: 1500, maxNoSpeechHallucinations: 0,
    minCoverageRatio: 0.5,
  });
  assert.deepEqual(rows.map((row) => row.verdict),
    ['not measured', 'not measured', 'not measured', 'not measured', 'not measured']);

  const failing = compareTargets(scoreRun(run(), gold), { maxWer: 0.01 });
  assert.equal(failing[0].verdict, 'not met');
  const meeting = compareTargets(scoreRun(run(), gold), { maxWer: 1 });
  assert.equal(meeting[0].verdict, 'met');
});

test('latency summary reports nulls instead of NaN for an empty run', () => {
  assert.deepEqual(summarizeLatency([]),
    { count: 0, mean: null, median: null, p95: null, max: null });
  assert.deepEqual(summarizeLatency([100, 200, 300]),
    { count: 3, mean: 200, median: 200, p95: 300, max: 300 });
});
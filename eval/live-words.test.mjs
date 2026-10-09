// P4 cross-module contract check for P1's live segment shape.
//
// P1 landed the unverified route: a successful decode emits timed
// `words: [{ text, start, end, conf: null }]`, and only failure, repetition,
// rejected audio, or unusable timestamps produce a gap. Every P4 module that
// touches a segment is validated against that exact shape here, so a change to
// it fails in one place instead of silently dropping captions or study terms.
//
// This is a UI/contract test. It is NOT recognition accuracy; fixture replay
// and this file must never be quoted as a WER/CER result.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { WhisperEngine } from '../web/asr.js';
import { parseFixture } from '../web/fixture.js';
import { mergeWordsAndGaps, reasonText } from '../web/captions.js';
import { deriveCoverage, gateSegment, UNVERIFIED_LABEL } from '../web/confidence.js';
import { classifyWord, tagSegment } from '../web/taglish.js';
import { extractVocab } from '../web/vocab.js';
import { buildSummary } from '../web/summary.js';

/** P2's measured defaults: 16 dB floor, 0.3 s speech, 0.5 s hangover. */
const P2_GATE = { snrThresholdDb: 16, minDurationSec: 0.3 };
/** P1's engine capability flag. False: whisper web exposes no word confidence. */
const CHECKS = { ...P2_GATE, supportsWordConfidence: false };

/**
 * Ask P1's real engine for a segment rather than hand-writing one, so this
 * test fails if P1's live output shape drifts.
 * @param {{ text: string, chunks?: object[], snrDb?: number }} [spec]
 */
async function liveSegmentFromP1(spec = {}) {
  const chunks = spec.chunks ?? spec.text
    .split(' ')
    .map((word, index) => ({
      text: word,
      timestamp: [index * 0.3, index * 0.3 + 0.28],
    }));
  class Worker {
    constructor() {}
    postMessage(message) {
      if (message?.type === 'load') {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'loaded', device: 'wasm' } }));
        return;
      }
      if (message?.type !== 'decode') return;
      queueMicrotask(() => this.onmessage?.({
        data: { type: 'decoded', id: message.id, text: spec.text ?? '', chunks },
      }));
    }
    terminate() {}
  }
  const original = globalThis.Worker;
  globalThis.Worker = Worker;
  try {
    const engine = new WhisperEngine({ model: 'stub' });
    await engine.init();
    const pcm = new Float32Array(16000); // 1.0 s
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 12) * 0.2;
    const segment = await engine.transcribe(pcm, {
      startSec: 0, hotwords: [], snrDb: spec.snrDb ?? 22,
      snrThresholdDb: P2_GATE.snrThresholdDb,
    });
    await engine.dispose();
    return segment;
  } finally {
    globalThis.Worker = original;
  }
}

test('P1 live decode reaches the P4 gate as timed words with conf: null', async () => {
  const live = await liveSegmentFromP1({ text: 'Ang halaman ay umausbong' });
  assert.equal(live.engine !== 'fixture', true);
  assert.equal(live.gaps.length, 0, 'a successful decode is not a gap');
  assert.deepEqual(live.words.map((word) => word.text),
    ['Ang', 'halaman', 'ay', 'umausbong']);
  assert.ok(live.words.every((word) => word.conf === null),
    'P1 must not invent a decoder confidence');
  assert.ok(live.words.every((word) => word.end <= live.end && word.start >= live.start));

  const gated = gateSegment(live, CHECKS);
  assert.equal(gated.words.length, 4);
  assert.deepEqual(gated.gaps, []);
  assert.ok(gated.words.every((word) => word.conf === null));
  assert.equal(gated.words.every((word) => word.conf === null) ? 'unverified' : 'scored',
    'unverified');
});

test('a low-SNR live segment is turned into a gap by P4\'s gate, with no invented words', async () => {
  const live = await liveSegmentFromP1({ text: 'Ang halaman', snrDb: 6 });
  // P1 decodes and reports words with its measured SNR attached; the audio
  // gate is P4's job and P2 owns the threshold. Rejected audio is a gap, never
  // a displayed word.
  assert.equal(live.words.length, 2);
  assert.ok(live.words.every((word) => word.conf === null));

  const gated = gateSegment(live, CHECKS);
  assert.equal(gated.words.length, 0);
  assert.equal(gated.gaps[0].reason.kind, 'snr_below_threshold');
  assert.equal(gated.gaps[0].start, live.start);
  assert.equal(gated.gaps[0].end, live.end);
  assert.equal(gated.gaps[0].reason.alternatives, undefined,
    'the live route carries no guessed alternatives');
  assert.match(reasonText(gated.gaps[0].reason.kind), /too noisy/i);
  assert.ok(!/error/i.test(reasonText(gated.gaps[0].reason.kind)));
});

test('no displayed word overlaps a gap and every time stays inside its segment', () => {
  const segments = [
    // A shape P1 can legitimately produce: decoded words plus a capture gap.
    { id: 'a', start: 0, end: 5, snrDb: 20, engine: 'whisper-webgpu', latencyMs: 700,
      words: [
        { text: 'Ang', start: 0, end: 0.4, conf: null },
        { text: 'halaman', start: 0.4, end: 1.3, conf: null },
        { text: 'uses', start: 3.6, end: 4.1, conf: null },
      ],
      gaps: [{ start: 1.3, end: 3.6, reason: { kind: 'low_confidence',
        alternatives: ['nag-aalok'] } }] },
    { id: 'b', start: 5, end: 6, snrDb: 20, engine: 'whisper-webgpu', latencyMs: 300,
      words: [], gaps: [{ start: 5, end: 6, reason: { kind: 'repetition_suppressed' } }] },
  ].map((segment) => gateSegment(segment, CHECKS));

  for (const segment of segments) {
    for (const word of segment.words) {
      assert.ok(word.start >= segment.start && word.end <= segment.end);
      for (const gap of segment.gaps) {
        assert.ok(!(word.start < gap.end && gap.start < word.end),
          `word "${word.text}" overlaps a gap`);
      }
    }
    for (const gap of segment.gaps) {
      assert.ok(gap.start >= segment.start && gap.end <= segment.end);
    }
    assert.deepEqual([...segment.gaps].sort((x, y) => x.start - y.start),
      segment.gaps, 'gaps come back sorted');
  }

  // The caption timeline must keep a gap a gap, in position order.
  const merged = mergeWordsAndGaps(segments[0]);
  assert.deepEqual(merged.map((item) => ('gap' in item ? 'GAP' : item.text)),
    ['Ang', 'halaman', 'GAP', 'uses']);
  assert.equal(merged[2].gap.reason.kind, 'low_confidence');
});

test('a gap guess never becomes a displayed word, study term, or summary line', () => {
  const segment = gateSegment({
    id: 'a', start: 0, end: 4, snrDb: 20, engine: 'whisper-webgpu', latencyMs: 500,
    words: [
      { text: 'Ang', start: 0, end: 0.4, conf: null },
      { text: 'halaman', start: 0.4, end: 1.2, conf: null },
    ],
    gaps: [{ start: 1.2, end: 2.4, reason: { kind: 'low_confidence',
      alternatives: ['invented-term'] } }],
  }, CHECKS);
  const session = { id: 'lesson-1', startedAt: 1, title: 'Halaman', flags: [],
    vocab: [], summaryLines: [], segments: [segment] };

  const items = extractVocab(session, { pairs: [{ tl: 'halaman', en: 'plant' }] });
  assert.ok(!items.some((item) => item.term === 'invented-term'));

  const lines = buildSummary(session);
  assert.ok(!lines.join('\n').includes('invented-term'));

  const merged = mergeWordsAndGaps(segment);
  const gapItem = merged.find((item) => item.gap);
  assert.ok(gapItem && !('text' in gapItem));
});

test('Taglish, vocabulary, summary, and coverage read the live word shape', () => {
  const segments = [
    gateSegment({ id: 'a', start: 0, end: 4, snrDb: 20, engine: 'whisper-webgpu',
      latencyMs: 500, words: [
        { text: 'Ang', start: 0, end: 0.4, conf: null },
        { text: 'halaman', start: 0.4, end: 1.2, conf: null },
        { text: 'uses', start: 1.2, end: 1.8, conf: null },
        { text: 'sunlight', start: 1.8, end: 2.6, conf: null },
      ], gaps: [] }, CHECKS),
    gateSegment({ id: 'b', start: 4, end: 5, snrDb: 20, engine: 'whisper-webgpu',
      latencyMs: 200, words: [], gaps: [{ start: 4, end: 5,
        reason: { kind: 'too_short' } }] }, CHECKS),
  ];
  const session = { id: 'lesson-1', startedAt: 1, title: 'Halaman', flags: [],
    vocab: [], summaryLines: [], segments };

  const tagged = tagSegment(segments[0], {
    tlTerms: ['halaman'], enTerms: ['uses', 'sunlight'],
  });
  assert.equal(tagged.label, 'MIX');
  assert.deepEqual(tagged.spans.map((span) => span.label), ['TL', 'TL', 'EN', 'EN']);
  assert.equal(classifyWord('halaman', { tlTerms: ['halaman'] }), 'TL');
  assert.equal(tagged.spans.every((span) =>
    segments[0].words.some((word) => word.conf === null)), true,
    'tagging annotations must not disturb the unverified words');

  const vocab = extractVocab(session, { pairs: [{ tl: 'halaman', en: 'plant' }] });
  assert.ok(vocab.length > 0);
  assert.ok(!vocab.some((item) => 'conf' in item),
    'vocabulary never carries a confidence score');

  const coverage = deriveCoverage(segments);
  assert.equal(coverage.confidentSec, 2.6);
  assert.equal(coverage.uncertainSec, 1);
  assert.equal(coverage.totalSec, 3.6);
  assert.ok(Math.abs(coverage.coverageRatio - 2.6 / 3.6) < 1e-9);

  const lines = buildSummary(session).join('\n');
  assert.match(lines, /unverified/i);
  assert.match(lines, /audio-quality checks/);
  assert.ok(!/\d+% confidence|accuracy/i.test(lines),
    'coverage is audio-gate pass time, not an accuracy score');
  assert.match(lines, /Ang halaman uses sunlight/);
});

test('the engine confidence flag stays false and the label stays honest', () => {
  const engine = new WhisperEngine({ model: 'stub' });
  assert.equal(engine.supportsWordConfidence, false,
    'whisper web exposes no decoder word confidence');
  assert.match(UNVERIFIED_LABEL, /decoder word confidence is unavailable/);
  for (const kind of ['low_confidence', 'snr_below_threshold', 'too_short',
    'repetition_suppressed']) {
    assert.match(reasonText(kind), /[a-z]/i);
  }
  assert.equal(reasonText('unknown_kind'), 'unclear');
});

test('fixture mode shows unverified words and honors the measured 16 dB default', async () => {
  const load = async (name) => parseFixture(JSON.parse(await readFile(
    new URL(`../lessons/fixtures/${name}.fixture.json`, import.meta.url), 'utf8')));

  // The fixture files carry authored `conf` numbers. They are not decoder
  // output, and the gate must strip them before anything reaches the screen.
  const clean = await load('clean');
  assert.ok(clean.flatMap((segment) => segment.words).some((word) => word.conf !== null),
    'the fixture files do carry authored scores, which is exactly the trap');
  const gatedClean = clean.map((segment) => gateSegment(segment, CHECKS));
  assert.equal(gatedClean.flatMap((s) => s.words).length, 111);
  assert.ok(gatedClean.flatMap((s) => s.words).every((word) => word.conf === null),
    'no fixture score may survive as if it were decoder confidence');

  const gatedNoisy = (await load('noisy')).map((segment) => gateSegment(segment, CHECKS));
  assert.equal(gatedNoisy.flatMap((s) => s.words).length, 0,
    'at the measured 16 dB default the noisy take is all gaps, not words');
  assert.ok(gatedNoisy.flatMap((s) => s.gaps).length > 0);
  assert.ok(gatedNoisy.every((segment) =>
    segment.gaps.every((gap) => gap.reason.kind === 'snr_below_threshold')));

  // Same audio, a relaxed threshold: the words come back, still unverified.
  const relaxed = (await load('noisy')).map((segment) =>
    gateSegment(segment, { ...CHECKS, snrThresholdDb: 0 }));
  assert.ok(relaxed.flatMap((s) => s.words).length > 0);
  assert.ok(relaxed.flatMap((s) => s.words).every((word) => word.conf === null));
});
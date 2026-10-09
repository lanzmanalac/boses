import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWord, tagSegment } from '../web/taglish.js';
import { extractVocab } from '../web/vocab.js';
import { buildSummary } from '../web/summary.js';
import { characterErrorRate, wordErrorRate } from './metrics.mjs';
import { sweepSnr } from './snr-sweep.mjs';

const session = {
  id: 'lesson-1', startedAt: 1, title: 'Plants', flags: [], vocab: [],
  summaryLines: [], segments: [{
    id: 'one', start: 0, end: 4, snrDb: 15, latencyMs: 20, engine: 'fixture',
    words: [
      { text: 'Ang', start: 0, end: 0.4, conf: null },
      { text: 'halaman', start: 0.4, end: 1.2, conf: null },
      { text: 'uses', start: 1.2, end: 1.7, conf: null },
      { text: 'sunlight', start: 1.7, end: 2.5, conf: null },
    ],
    gaps: [{ start: 2.5, end: 3.5, reason: {
      kind: 'snr_below_threshold', alternatives: ['invented-term'],
    } }],
  }],
};

test('Taglish pass annotates known words without rewriting the transcript', () => {
  const before = JSON.stringify(session.segments[0]);
  const result = tagSegment(session.segments[0], {
    tlTerms: ['halaman'], enTerms: ['uses', 'sunlight', 'print'],
  });
  assert.equal(result.label, 'MIX');
  assert.deepEqual(result.spans.map((span) => span.label), ['TL', 'TL', 'EN', 'EN']);
  assert.equal(classifyWord('nag-print', { enTerms: ['print'] }), 'MIX');
  assert.equal(classifyWord('photosynthesis'), null);
  assert.equal(JSON.stringify(session.segments[0]), before);
});

test('vocabulary excludes gap guesses and only shows attested glossary pairs', () => {
  const withPair = structuredClone(session);
  withPair.segments[0].words.push({ text: 'plant', start: 3.5, end: 4, conf: null });
  const items = extractVocab(withPair, { pairs: [{ tl: 'halaman', en: 'plant' },
    { tl: 'araw', en: 'sun' }] });
  assert.ok(items.some((item) => item.tl === 'halaman' && item.en === 'plant'));
  assert.ok(!items.some((item) => item.term === 'invented-term'));
  assert.ok(!items.some((item) => item.tl === 'araw'));
});

test('deterministic overview uses captured wording and marks it unverified', () => {
  const lines = buildSummary(session);
  assert.ok(lines.some((line) => line.includes('Ang halaman uses sunlight')));
  assert.ok(lines.some((line) => line.includes('unverified')));
  assert.ok(!lines.some((line) => line.includes('invented-term')));
});

test('offline WER/CER count a substitution and preserve Taglish words', () => {
  const result = wordErrorRate('Ang halaman ay buhay.', 'Ang halaman ay green.');
  assert.equal(result.referenceUnits, 4);
  assert.equal(result.substitutions, 1);
  assert.equal(result.rate, 0.25);
  const cer = characterErrorRate('A b', 'a c');
  assert.equal(cer.referenceUnits, 2);
  assert.equal(cer.errors, 1);
  assert.equal(wordErrorRate('', '').rate, null);
});

test('SNR sweep exposes false accepts and rejected speech without choosing a cutoff', () => {
  const cases = [
    { snrDb: 15, speechPresent: true, goldText: 'ang halaman', rawText: 'ang halaman' },
    { snrDb: 5, speechPresent: true, goldText: 'ang halaman', rawText: 'ang palayan' },
    { snrDb: 2, speechPresent: false, goldText: '', rawText: 'hello' },
  ];
  const [loose, strict] = sweepSnr(cases, [0, 10]);
  assert.equal(loose.acceptedSegments, 3);
  assert.equal(loose.acceptedSpeechWithWordErrors, 1);
  assert.equal(loose.acceptedNoSpeechOutputs, 1);
  assert.equal(strict.acceptedSegments, 1);
  assert.equal(strict.rejectedSpeechSegments, 1);
  assert.equal(strict.acceptedNoSpeechOutputs, 0);
});

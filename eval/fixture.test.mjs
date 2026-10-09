import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FixtureEngine, parseFixture } from '../web/fixture.js';

const sample = {
  id: 'example-1', start: 0, end: 2, snrDb: 18, latencyMs: 40,
  words: [{ text: 'Magandang', start: 0, end: 0.7, conf: 0.92 }],
  gaps: [{ start: 0.8, end: 1.4, reason: { kind: 'low_confidence' } }],
};

test('accepts either fixture wrapper and keeps gaps separate from words', () => {
  for (const input of [[sample], { segments: [sample] }]) {
    const [segment] = parseFixture(input);
    assert.equal(segment.engine, 'fixture');
    assert.equal(segment.words.length, 1);
    assert.equal(segment.gaps[0].reason.kind, 'low_confidence');
  }
});

test('accepts explicit unverified words but rejects a missing field or overlap', () => {
  assert.equal(parseFixture([{ ...sample, words: [{ ...sample.words[0], conf: null }] }])[0]
    .words[0].conf, null);
  const { conf, ...withoutConfidence } = sample.words[0];
  assert.throws(() => parseFixture([{ ...sample, words: [withoutConfidence] }]), /confidence/);
  assert.throws(() => parseFixture([{ ...sample, gaps: [{
    start: 0.5, end: 1.4, reason: { kind: 'low_confidence' },
  }] }]), /overlaps/);
});

test('replays supplied segments without a model and does not leak mutable state', async () => {
  const engine = new FixtureEngine({ segments: [sample] });
  const progress = [];
  await engine.init((value) => progress.push(value));
  assert.deepEqual(progress, [0, 1]);
  assert.equal(engine.supportsWordConfidence, false);
  const first = await engine.transcribe(new Float32Array(), {
    startSec: 0, hotwords: [], snrDb: 18, snrThresholdDb: 5,
  });
  first.words[0].text = 'changed';
  assert.equal((await engine.segments())[0].words[0].text, 'Magandang');
  await assert.rejects(engine.transcribe(new Float32Array(), {
    startSec: 0, hotwords: [], snrDb: 18, snrThresholdDb: 5,
  }), /no more segments/);
  await engine.dispose();
  assert.equal((await engine.segments())[0].words[0].text, 'Magandang');
});

test('loads the expected P2 path and reports a missing fixture clearly', async () => {
  let requested;
  const engine = new FixtureEngine({ fixture: 'taglish', fetcher: async (url) => {
    requested = url.pathname;
    return { ok: true, json: async () => ({ segments: [sample] }) };
  } });
  await engine.init();
  assert.match(requested, /\/lessons\/fixtures\/taglish\.fixture\.json$/);
  assert.equal((await engine.segments()).length, 1);

  const missing = new FixtureEngine({ fetcher: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(missing.init(), /HTTP 404/);
});

test('loads every committed P2 fixture', async () => {
  for (const fixture of ['clean', 'noisy', 'taglish']) {
    const input = JSON.parse(readFileSync(
      new URL(`../lessons/fixtures/${fixture}.fixture.json`, import.meta.url),
      'utf8',
    ));
    const segments = parseFixture(input, fixture);
    assert.ok(segments.length > 0, `${fixture} fixture should contain segments`);
    for (const segment of segments) {
      assert.equal(segment.engine, 'fixture');
      assert.ok(segment.words.every((word) => word.start >= segment.start && word.end <= segment.end));
      assert.ok(segment.gaps.every((gap) => gap.start >= segment.start && gap.end <= segment.end));
    }
  }
});

test('selects fixture mode without loading the absent P1 module', async () => {
  globalThis.location = { search: '?fixture=1' };
  const { default: defaultEngine, selectEngine } = await import('../web/engine-select.js');
  assert.equal(defaultEngine.id, 'fixture');
  assert.equal(defaultEngine.fixture, 'clean');
  assert.equal((await selectEngine('?fixture=noisy')).fixture, 'noisy');
  await assert.rejects(selectEngine('?fixture=unknown'), /Unknown fixture/);
  delete globalThis.location;
});

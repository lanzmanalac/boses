import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { WhisperEngine } from './asr.js';
import { buildHotwordPrompt } from './hotwords.js';
import { measureHotwordBias, readGold, wer } from './hw-eval.js';

const harness = {
  silent: false,
  decodeText: 'mitokondria sa selula',
  decodeCount: 0,
  loadCount: 0,
  /** @type {{ text: string, timestamp: [number, number | null] }[] | null} */
  chunks: null,
  /** @type {FakeWorker[]} */
  instances: [],
};

class FakeWorker {
  /**
   * @param {string | URL} url
   * @param {WorkerOptions} [options]
   */
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    /** @type {object[]} */
    this.posted = [];
    /** @type {((ev: { data: object }) => void) | null} */
    this.onmessage = null;
    /** @type {Function | null} */
    this.onerror = null;
    this.terminated = false;
    harness.instances.push(this);
  }

  /** @param {object} msg */
  postMessage(msg) {
    this.posted.push(msg);
    if (msg?.type === 'load') {
      harness.loadCount += 1;
      queueMicrotask(() => {
        if (this.terminated) return;
        this.onmessage?.({ data: { type: 'loaded', device: 'wasm' } });
      });
    }
    if (msg?.type === 'decode') {
      harness.decodeCount += 1;
      if (harness.silent) return;
      queueMicrotask(() => {
        if (this.terminated) return;
        const text = harness.decodeText;
        const chunks = harness.chunks ?? [{ text, timestamp: [0, msg.pcm.length / 16000] }];
        this.onmessage?.({
          data: {
            type: 'decoded',
            id: msg.id,
            text,
            chunks,
          },
        });
      });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

function resetHarness() {
  harness.silent = false;
  harness.decodeText = 'mitokondria sa selula';
  harness.decodeCount = 0;
  harness.loadCount = 0;
  harness.chunks = null;
  harness.instances = [];
  globalThis.Worker = FakeWorker;
}

beforeEach(resetHarness);

test('buildHotwordPrompt([]) is null and a term is a non-empty string', () => {
  assert.equal(buildHotwordPrompt([]), null);
  const prompt = buildHotwordPrompt(['mitokondria']);
  assert.equal(typeof prompt, 'string');
  assert.ok(prompt.length > 0);
});

test('wer is 0 for a match and 0.5 for one insertion against two gold tokens', () => {
  assert.equal(wer('a b', 'a b'), 0);
  assert.equal(wer('a', 'a b'), 0.5);
});

test('readGold of a missing path is null', async () => {
  assert.equal(await readGold('lessons/gold/no-such-transcript.txt'), null);
});

test('a clear decode yields unverified words inside the segment', async () => {
  const engine = new WhisperEngine();
  assert.equal(engine.supportsWordConfidence, false);
  const pcm = new Float32Array(1600);
  const seg = await engine.transcribe(pcm, { startSec: 1.5, snrDb: 12 });
  assert.equal(engine.supportsWordConfidence, false);
  assert.ok(seg.words.length >= 1);
  assert.equal(seg.gaps.length, 0);
  for (const word of seg.words) {
    assert.equal(word.conf, null);
    assert.ok(word.start >= seg.start);
    assert.ok(word.end <= seg.end);
    assert.ok(word.end > word.start);
  }
  assert.equal(seg.raw.text, 'mitokondria sa selula');
  assert.equal(seg.start, 1.5);
  assert.equal(seg.end, 1.5 + 1600 / 16000);
  assert.equal(seg.snrDb, 12);
  await engine.dispose();
});

test('a chunk with a null end is a gap with no words or alternatives', async () => {
  harness.chunks = [{ text: 'mitokondria', timestamp: [0, null] }];
  const engine = new WhisperEngine();
  const pcm = new Float32Array(1600);
  const seg = await engine.transcribe(pcm, { startSec: 1.5, snrDb: 12 });
  assert.equal(seg.words.length, 0);
  assert.equal(seg.gaps.length, 1);
  assert.equal(seg.gaps[0].reason.kind, 'low_confidence');
  assert.equal(seg.gaps[0].reason.alternatives, undefined);
  await engine.dispose();
});

test('a chunk ending more than 0.25 s past the clip is a gap', async () => {
  harness.chunks = [{ text: 'mitokondria', timestamp: [0, 0.36] }];
  const engine = new WhisperEngine();
  const pcm = new Float32Array(1600);
  const seg = await engine.transcribe(pcm, { startSec: 1.5, snrDb: 12 });
  assert.equal(seg.end, 1.6);
  assert.equal(seg.words.length, 0);
  assert.equal(seg.gaps.length, 1);
  assert.equal(seg.gaps[0].reason.kind, 'low_confidence');
  assert.equal(seg.gaps[0].reason.alternatives, undefined);
  await engine.dispose();
});

test('a chunk ending less than 0.25 s past the clip is clamped and kept', async () => {
  harness.chunks = [{ text: 'mitokondria', timestamp: [0, 0.3] }];
  const engine = new WhisperEngine();
  const pcm = new Float32Array(1600);
  const seg = await engine.transcribe(pcm, { startSec: 1.5, snrDb: 12 });
  assert.equal(seg.end, 1.6);
  assert.equal(seg.words.length, 1);
  assert.equal(seg.words[0].text, 'mitokondria');
  assert.equal(seg.words[0].conf, null);
  assert.equal(seg.words[0].start, 1.5);
  assert.equal(seg.words[0].end, 1.6);
  assert.equal(seg.gaps.length, 0);
  await engine.dispose();
});

test('different hotwords do not share one transcribe promise', async () => {
  const engine = new WhisperEngine();
  const pcm = new Float32Array(1600);
  const bare = engine.transcribe(pcm, { startSec: 0, snrDb: 10, hotwords: [] });
  const biased = engine.transcribe(pcm, { startSec: 0, snrDb: 10, hotwords: ['mitokondria'] });
  assert.notEqual(bare, biased);
  await bare;
  await biased;
  assert.equal(harness.decodeCount, 2);
  await engine.dispose();
});

test('duplicate transcribe posts one decode', async () => {
  const engine = new WhisperEngine();
  const pcm = new Float32Array(3200);
  const opts = { startSec: 4, snrDb: 9, hotwords: [], snrThresholdDb: 3 };
  const p1 = engine.transcribe(pcm, opts);
  const p2 = engine.transcribe(pcm, opts);
  assert.equal(p1, p2);
  const seg = await p1;
  assert.equal(harness.decodeCount, 1);
  assert.ok(seg.words.length >= 1);
  assert.equal(seg.gaps.length, 0);
  assert.equal(seg.words[0].conf, null);
  await engine.dispose();
});

test('timeout is a low_confidence gap with no alternatives', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  harness.silent = true;
  const engine = new WhisperEngine();
  const pcm = new Float32Array(16000);
  const p = engine.transcribe(pcm, { startSec: 0, snrDb: 8 });
  t.mock.timers.tick(8000);
  const seg = await p;
  assert.equal(seg.words.length, 0);
  assert.equal(seg.gaps.length, 1);
  assert.equal(seg.gaps[0].reason.kind, 'low_confidence');
  assert.equal(seg.gaps[0].reason.alternatives, undefined);
  await engine.dispose();
});

test('empty PCM is too_short', async () => {
  const engine = new WhisperEngine();
  const seg = await engine.transcribe(new Float32Array(0), { startSec: 2, snrDb: 20 });
  assert.equal(seg.words.length, 0);
  assert.equal(seg.gaps[0].reason.kind, 'too_short');
  assert.equal(seg.gaps[0].reason.alternatives, undefined);
  assert.equal(harness.decodeCount, 0);
  await engine.dispose();
});

test('measureHotwordBias reports missing gold instead of inventing text', async () => {
  const engine = new WhisperEngine();
  const missing = 'lessons/gold/does-not-exist.txt';
  const result = await measureHotwordBias(engine, new Float32Array(16), ['mitokondria'], missing);
  assert.equal(result.goldMissing, true);
  assert.equal(result.goldPath, missing);
  assert.equal(typeof result.message, 'string');
  assert.equal(harness.decodeCount, 0);
  await engine.dispose();
});

test('measureHotwordBias scores the real gold file', async () => {
  const engine = new WhisperEngine();
  const result = await measureHotwordBias(engine, new Float32Array(16), ['mitokondria']);
  assert.equal(result.goldMissing, false);
  assert.equal(result.goldPath, 'lessons/gold/lesson-clean.transcript.txt');
  assert.equal(typeof result.werWithout, 'number');
  assert.equal(typeof result.werWith, 'number');
  await engine.dispose();
});

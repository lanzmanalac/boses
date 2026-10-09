// Run: node --test web/
// Exercises the noise guards on P2's real recordings in lessons/sample/.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Segmenter, HighPass, gate, rmsDb, SAMPLE_RATE } from './noise.js';
import { Downsampler, gapSegment, connectCapture } from './capture.js';

const sample = (name) => new URL(`../lessons/sample/${name}.wav`, import.meta.url);

/** Minimal 16-bit PCM WAV reader. */
function readWav(url) {
  const b = readFileSync(url);
  let o = 12;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') assert.equal(b.readUInt32LE(o + 12), SAMPLE_RATE, 'fixture audio must be 16 kHz');
    if (id === 'data') {
      const data = b.subarray(o + 8, o + 8 + size);
      const f = new Float32Array(data.length / 2);
      for (let i = 0; i < f.length; i++) f[i] = data.readInt16LE(i * 2) / 32768;
      return f;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

function segmentFile(name, opts) {
  const s = new Segmenter(opts);
  const out = [];
  s.onSegment((seg) => out.push(seg));
  const pcm = readWav(sample(name));
  for (let i = 0; i < pcm.length; i += 2048) s.push(pcm.subarray(i, i + 2048));
  s.flush();
  return out;
}

test('noise-only clip: nothing reaches the decoder', () => {
  const segs = segmentFile('noise-only');
  assert.ok(segs.length > 0, 'babble should be detected, not ignored');
  assert.deepEqual(segs.filter((s) => !s.reason), []);
});

test('clean take: every labelled line is covered by a decoded segment', () => {
  const segs = segmentFile('lesson-clean').filter((s) => !s.reason);
  const labels = readFileSync(new URL('../lessons/gold/lesson-clean.labels.txt', import.meta.url), 'utf8')
    .trim().split('\n').map((l) => l.split('\t').map(Number));
  for (const [start, end] of labels) {
    const mid = (start + end) / 2;
    assert.ok(segs.some((s) => s.startSec <= mid && mid <= s.endSec), `line at ${start}s not captured`);
  }
  assert.ok(segs.every((s) => s.endSec - s.startSec <= 12.5), 'segments are force-cut at 12 s');
});

test('noisy take: speech still passes, short blips are too_short', () => {
  const segs = segmentFile('lesson-noisy');
  assert.ok(segs.filter((s) => !s.reason).length >= 10);
  for (const s of segs.filter((x) => x.reason === 'too_short')) assert.ok(s.endSec - s.startSec < 1);
});

test('gate: thresholds and steady-noise guard', () => {
  assert.equal(gate({ durationSec: 0.2, snrDb: 30, frameDbStd: 8 }), 'too_short');
  assert.equal(gate({ durationSec: 2, snrDb: 9, frameDbStd: 8 }), 'snr_below_threshold');
  assert.equal(gate({ durationSec: 5, snrDb: 20, frameDbStd: 1.5 }), 'snr_below_threshold');
  assert.equal(gate({ durationSec: 2, snrDb: 20, frameDbStd: 8 }), undefined);
});

test('high-pass removes 50 Hz hum but keeps 1 kHz', () => {
  const tone = (hz) => Float32Array.from({ length: SAMPLE_RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
  const drop = (hz) => rmsDb(tone(hz)) - rmsDb(new HighPass().process(tone(hz)).subarray(SAMPLE_RATE / 2));
  assert.ok(drop(50) > 6, `50 Hz attenuated only ${drop(50).toFixed(1)} dB`);
  assert.ok(Math.abs(drop(1000)) < 1);
});

test('downsampler: 48 kHz -> 16 kHz length and continuity across chunks', () => {
  const d = new Downsampler(48000, 16000);
  let total = 0;
  for (let i = 0; i < 10; i++) total += d.process(new Float32Array(4800).fill(0.25)).length;
  assert.ok(Math.abs(total - 16000) <= 2, `got ${total}`);
});

test('connectCapture: gated segments skip the engine, others are decoded in order', async () => {
  const listeners = [];
  const fakeCapture = { onSegment: (cb) => listeners.push(cb) };
  const calls = [];
  const engine = {
    id: 'whisper-wasm',
    transcribe: async (pcm, o) => { calls.push(o.startSec); return { id: `d${o.startSec}`, start: o.startSec } },
  };
  const out = [];
  connectCapture(fakeCapture, engine, { hotwords: ['chlorophyll'] }).onSegment((s) => out.push(s));
  const pcm = new Float32Array(1600);
  listeners[0]({ pcm, startSec: 1, endSec: 1.1, snrDb: 5, reason: 'snr_below_threshold' });
  listeners[0]({ pcm, startSec: 2, endSec: 3, snrDb: 25 });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [2]);
  assert.equal(out[0].gaps[0].reason.kind, 'snr_below_threshold');
  assert.equal(out[1].id, 'd2');
  assert.deepEqual(gapSegment({ pcm, startSec: 0, endSec: 0.2, snrDb: 3, reason: 'too_short' }, 'fixture', 'x').words, []);
});

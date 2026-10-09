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

test('noisy take: every labelled line still reaches ASR, short blips are too_short', () => {
  const segs = segmentFile('lesson-noisy');
  const passed = segs.filter((s) => !s.reason);
  const labels = readFileSync(new URL('../lessons/gold/lesson-noisy.labels.txt', import.meta.url), 'utf8')
    .trim().split('\n').map((l) => l.split('\t').map(Number));
  for (const [start, end] of labels) {
    const mid = (start + end) / 2;
    assert.ok(passed.some((s) => s.startSec <= mid && mid <= s.endSec), `noisy line at ${start}s dropped`);
  }
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

test('long speech is cut at a quiet dip near the limit, not mid-word', () => {
  const sr = SAMPLE_RATE;
  const pcm = new Float32Array(22 * sr);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    const speaking = t >= 1 && t < 21 && !(t >= 11.2 && t < 11.4); // 200 ms dip: shorter than a real pause
    const syllables = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);  // 4 Hz modulation, like speech
    pcm[i] = (speaking ? 0.3 * syllables : 0.001) * Math.sin(2 * Math.PI * 300 * t);
  }
  const s = new Segmenter();
  const out = [];
  s.onSegment((seg) => out.push(seg));
  for (let i = 0; i < pcm.length; i += 2048) s.push(pcm.subarray(i, i + 2048));
  s.flush();
  const first = out[0];
  assert.ok(first.endSec - first.startSec <= 12.3, 'force-cut at the 12 s limit');
  assert.ok(Math.abs(first.endSec - 11.3) < 0.4, `cut at ${first.endSec}s, expected the dip at ~11.3 s`);
  assert.ok(Math.abs(out[1].startSec - first.endSec) < 0.05, 'remainder continues without losing audio');
});

test('mic warm-up silence does not drag the room floor down', () => {
  const sr = SAMPLE_RATE;
  const pcm = new Float32Array(8 * sr);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    const room = t < 0.8 ? 0 : 0.002 * Math.sin(2 * Math.PI * 120 * t + 1);  // digital zeros, then a real room
    const voice = t >= 2 && t < 4 ? 0.2 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 300 * t) : 0;
    pcm[i] = room + voice;
  }
  const s = new Segmenter();
  const out = [];
  s.onSegment((seg) => out.push(seg));
  for (let i = 0; i < pcm.length; i += 2048) s.push(pcm.subarray(i, i + 2048));
  s.flush();
  assert.ok(s.floorDb >= -75, `floor ${s.floorDb}`);
  assert.ok(out.every((seg) => seg.snrDb < 60), 'SNR not inflated by a near-zero floor');
});

test('MicCapture keeps a per-segment gate log for device tests', async () => {
  const { MicCapture } = await import('./capture.js');
  const mic = new MicCapture();
  const pcm = readWav(sample('lesson-noisy'));
  for (let i = 0; i < pcm.length; i += 2048) mic.segmenter.push(pcm.subarray(i, i + 2048));
  mic.segmenter.flush();
  const log = mic.exportLog();
  assert.ok(log.segments.length > 5);
  assert.ok(log.segments.some((s) => s.result === 'sent_to_asr'));
  for (const s of log.segments) {
    assert.ok(Number.isFinite(s.snrDb) && Number.isFinite(s.floorDb) && s.durSec > 0);
    assert.match(s.result, /^(sent_to_asr|too_short|snr_below_threshold)$/);
  }
  assert.equal(log.settings.snrThresholdDb, 16);
});

// ── stress tests ────────────────────────────────────────────────────────────
const run = (pcm, chunk = 2048, opts) => {
  const s = new Segmenter(opts);
  const out = [];
  s.onSegment((seg) => out.push(seg));
  for (let i = 0; i < pcm.length; i += chunk) s.push(pcm.subarray(i, i + chunk));
  s.flush();
  return { out, s };
};
const key = (segs) => segs.map((x) => `${x.startSec}-${x.endSec}-${x.snrDb}-${x.reason ?? 'asr'}`).join('|');
const labelsOf = (name) => readFileSync(new URL(`../lessons/gold/${name}.labels.txt`, import.meta.url), 'utf8')
  .trim().split('\n').map((l) => l.split('\t').map(Number));
const covered = (segs, labels) => labels.filter(([a, b]) => segs.some((s) => !s.reason && s.startSec <= (a + b) / 2 && (a + b) / 2 <= s.endSec)).length;

test('stress: results do not depend on how the browser chunks audio', () => {
  const pcm = readWav(sample('lesson-noisy'));
  const ref = key(run(pcm, 2048).out);
  for (const chunk of [128, 441, 4096, 7919]) assert.equal(key(run(pcm, chunk).out), ref, `chunk ${chunk}`);
});

test('stress: 30-minute lesson runs far faster than real time with bounded memory', () => {
  const sr = SAMPLE_RATE;
  const pcm = new Float32Array(30 * 60 * sr);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    const talking = (t % 7) < 5; // 5 s talk, 2 s pause
    pcm[i] = (talking ? 0.2 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 300 * t) : 0) + 0.002 * Math.sin(2 * Math.PI * 97 * t);
  }
  const t0 = performance.now();
  const { out, s } = run(pcm);
  const sec = (performance.now() - t0) / 1000;
  assert.ok(sec < 60, `30 min of audio took ${sec.toFixed(1)} s`);
  assert.ok(s.history.length <= 5 * 50 && s.preRoll.length <= 10, 'buffers stay bounded');
  assert.ok(out.length > 200 && out.every((x) => x.endSec - x.startSec <= 12.3));
});

test('stress: shouting into the mic (clipped audio) still captures every line', () => {
  const pcm = readWav(sample('lesson-clean')).map((v) => Math.max(-1, Math.min(1, v * 12)));
  assert.equal(covered(run(pcm).out, labelsOf('lesson-clean')), 13);
});

test('stress: 60 s of digital silence produces nothing', () => {
  assert.equal(run(new Float32Array(60 * SAMPLE_RATE)).out.length, 0);
});

test('stress: steady hum (fan/aircon) never reaches ASR', () => {
  const pcm = Float32Array.from({ length: 20 * SAMPLE_RATE }, (_, i) => (i > SAMPLE_RATE * 3 ? 0.3 : 0.002) * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE));
  assert.deepEqual(run(pcm).out.filter((x) => !x.reason), []);
});

test('P1 compatibility: timed unverified words pass through unchanged; engine errors become gaps', async () => {
  const listeners = [];
  const fakeCapture = { onSegment: (cb) => listeners.push(cb) };
  let call = 0;
  const engine = {
    id: 'whisper-webgpu',
    supportsWordConfidence: false,
    transcribe: async (pcm, o) => {
      if (++call === 2) throw new Error('worker crashed');
      return { id: `d${o.startSec}`, start: o.startSec, end: o.startSec + 1, snrDb: o.snrDb, engine: 'whisper-webgpu', latencyMs: 5,
        words: [{ text: 'chlorophyll', start: o.startSec, end: o.startSec + 0.5, conf: null }], gaps: [],
        raw: { text: 'chlorophyll', decodeMs: 5, outcome: 'decoded' } };
    },
  };
  const out = [];
  connectCapture(fakeCapture, engine, {}).onSegment((s) => out.push(s));
  const pcm = new Float32Array(16000);
  for (const t of [1, 3, 5]) listeners[0]({ pcm, startSec: t, endSec: t + 1, snrDb: 30 });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(out.map((s) => s.start), [1, 3, 5], 'order kept, nothing dropped');
  assert.equal(out[0].words[0].conf, null);
  assert.equal(out[0].raw.text, 'chlorophyll');
  assert.equal(out[1].gaps[0].reason.kind, 'low_confidence', 'crash shows as a gap');
  assert.equal(out[2].words[0].text, 'chlorophyll', 'later pieces still decode');
});

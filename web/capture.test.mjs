// Run: node --test web/
// MicCapture.start()/stop() against simulated browsers (no real mic needed).
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { MicCapture } from './capture.js';

/** Minimal Web Audio + getUserMedia fakes. `browser` sets the quirks. */
function fakeBrowser({ micRate = 48000, firefoxRateCheck = false, rejectRateOption = false, startsSuspended = false } = {}) {
  const made = { contexts: [], tracksStopped: 0, resumed: 0 };
  class FakeContext {
    constructor(opts) {
      if (opts?.sampleRate && rejectRateOption) throw new DOMException('rate not supported', 'NotSupportedError');
      this.sampleRate = opts?.sampleRate ?? micRate;
      this.state = startsSuspended ? 'suspended' : 'running';
      this.closed = false;
      this.audioWorklet = { addModule: async () => {} };
      made.contexts.push(this);
    }
    createMediaStreamSource() {
      if (firefoxRateCheck && this.sampleRate !== micRate) throw new DOMException('different sample-rate', 'NotSupportedError');
      return { connect: () => {} };
    }
    async resume() { this.state = 'running'; made.resumed++; }
    async close() { this.closed = true; }
  }
  class FakeNode {
    constructor() { this.port = { onmessage: null, close: () => {} }; made.node = this; }
    disconnect() {}
  }
  const track = { stop: () => { made.tracksStopped++; }, label: 'Fake mic' };
  globalThis.AudioContext = FakeContext;
  globalThis.AudioWorkletNode = FakeNode;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
  });
  return made;
}

afterEach(() => { delete globalThis.AudioContext; delete globalThis.AudioWorkletNode; });

const feed = (made, rate, seconds) => {
  for (let i = 0; i < seconds * rate; i += 2048) made.node.port.onmessage({ data: new Float32Array(Math.min(2048, seconds * rate - i)) });
};

test('Chrome-like: 16 kHz context, no JS resampling', async () => {
  const made = fakeBrowser();
  const mic = new MicCapture();
  await mic.start();
  assert.equal(mic.ctx.sampleRate, 16000);
  assert.equal(mic.resampler, null);
  await mic.stop();
  assert.equal(made.tracksStopped, 1);
});

test('Firefox-like: mic rate mismatch falls back to 48 kHz + Downsampler', async () => {
  const made = fakeBrowser({ firefoxRateCheck: true });
  const mic = new MicCapture();
  await mic.start();
  assert.equal(mic.ctx.sampleRate, 48000);
  assert.ok(mic.resampler, 'resamples in JS');
  assert.ok(made.contexts[0].closed, 'the rejected 16 kHz context is closed');
  feed(made, 48000, 2);
  const got = mic.segmenter.frameIndex * 320 + mic.segmenter.pending.length;
  assert.ok(Math.abs(got - 32000) < 400, `2 s at 48 kHz -> ${got} samples at 16 kHz`);
  await mic.stop();
});

test('Browser that rejects the sampleRate option still starts', async () => {
  fakeBrowser({ rejectRateOption: true, micRate: 44100 });
  const mic = new MicCapture();
  await mic.start();
  assert.equal(mic.ctx.sampleRate, 44100);
  assert.ok(mic.resampler);
  await mic.stop();
});

test('iOS-like: a suspended context is resumed', async () => {
  const made = fakeBrowser({ startsSuspended: true });
  const mic = new MicCapture();
  await mic.start();
  assert.equal(made.resumed, 1);
  assert.equal(mic.ctx.state, 'running');
  await mic.stop();
});

test('if no context works, start() rejects and the mic is released', async () => {
  const made = fakeBrowser({ firefoxRateCheck: true, micRate: 48000 });
  globalThis.AudioContext = class { constructor() { throw new Error('no audio'); } };
  await assert.rejects(new MicCapture().start());
  assert.equal(made.tracksStopped, 1);
});

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

const MODEL_ID = 'Xenova/whisper-tiny';
const PROMPT_TOKEN_CAP = 223;

/** @typedef {{ text: string, timestamp: [number, number | null] }} PipelineChunk */

/**
 * @typedef {
 *   | { type: 'load' }
 *   | { type: 'decode', id: string, pcm: Float32Array, prompt: string | null }
 * } ToWorker
 */

/**
 * @typedef {
 *   | { type: 'progress', p: number }
 *   | { type: 'loaded', device: 'webgpu' | 'wasm' }
 *   | { type: 'load_failed', message: string }
 *   | { type: 'decoded', id: string, text: string, chunks: PipelineChunk[] }
 *   | { type: 'decode_failed', id: string }
 * } FromWorker
 */

let asr = null;
let device = /** @type {'webgpu' | 'wasm'} */ ('wasm');

/**
 * @param {unknown} info
 * @returns {number}
 */
function progress01(info) {
  const raw =
    info && typeof info === 'object' && 'progress' in info
      ? Number(/** @type {{ progress?: number }} */ (info).progress)
      : NaN;
  if (!Number.isFinite(raw)) return 0;
  const p = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, p));
}

/**
 * @param {unknown} tokenizer
 * @param {string} prompt
 * @returns {number[]}
 */
function decoderInputIds(tokenizer, prompt) {
  const encode = (s) => {
    const ids = tokenizer.encode(s, { add_special_tokens: false });
    return Array.from(ids);
  };
  const prefix = encode('<|startofprev|>');
  let body = encode(prompt);
  if (body.length > PROMPT_TOKEN_CAP) body = body.slice(body.length - PROMPT_TOKEN_CAP);
  return prefix.concat(
    body,
    encode('<|startoftranscript|>'),
    encode('<|tl|>'),
    encode('<|transcribe|>'),
  );
}

async function loadPipeline() {
  if (asr) {
    self.postMessage(/** @type {FromWorker} */ ({ type: 'loaded', device }));
    return;
  }
  const opts = {
    progress_callback: (info) => {
      self.postMessage(/** @type {FromWorker} */ ({ type: 'progress', p: progress01(info) }));
    },
  };
  try {
    asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
      ...opts,
      device: 'webgpu',
    });
    device = 'webgpu';
  } catch {
    asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
      ...opts,
      device: 'wasm',
    });
    device = 'wasm';
  }
  self.postMessage(/** @type {FromWorker} */ ({ type: 'loaded', device }));
}

/**
 * @param {string} id
 * @param {Float32Array} pcm
 * @param {string | null} prompt
 */
async function decode(id, pcm, prompt) {
  if (!asr) {
    self.postMessage(/** @type {FromWorker} */ ({ type: 'decode_failed', id }));
    return;
  }
  try {
    const gen = {
      return_timestamps: 'word',
      chunk_length_s: 30,
      language: 'tl',
      task: 'transcribe',
    };
    if (prompt) gen.decoder_input_ids = decoderInputIds(asr.tokenizer, prompt);
    const out = await asr(pcm, gen);
    const text = typeof out?.text === 'string' ? out.text : '';
    const chunks = Array.isArray(out?.chunks) ? out.chunks : [];
    self.postMessage(/** @type {FromWorker} */ ({ type: 'decoded', id, text, chunks }));
  } catch {
    self.postMessage(/** @type {FromWorker} */ ({ type: 'decode_failed', id }));
  }
}

self.onmessage = async (ev) => {
  /** @type {ToWorker} */
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      await loadPipeline();
      return;
    }
    if (msg.type === 'decode') {
      await decode(msg.id, msg.pcm, msg.prompt ?? null);
    }
  } catch (err) {
    if (msg && msg.type === 'load') {
      self.postMessage(
        /** @type {FromWorker} */ ({
          type: 'load_failed',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } else if (msg && msg.type === 'decode') {
      self.postMessage(/** @type {FromWorker} */ ({ type: 'decode_failed', id: msg.id }));
    }
  }
};

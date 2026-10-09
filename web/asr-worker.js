import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

// Model per device. Measured on the team's clean lesson (browser output, loop
// lines excluded): base + hotwords 50% WER vs tiny + hotwords 65%. Base costs
// ~3 s per line and ~290 MB on WebGPU, so phones and WASM keep tiny (~41 MB q8).
// Override for testing with ?model=tiny or ?model=base on the page URL.
const MODELS = { base: 'Xenova/whisper-base', tiny: 'Xenova/whisper-tiny' };
const PROMPT_TOKEN_CAP = 223;
// Whisper keeps generating until 448 tokens when it loops; a measured loop line
// took 16 s. Normal Taglish speech stays well under ~12 tokens/s.
const TOKENS_PER_SEC = 12;
const MIN_NEW_TOKENS = 24;

/** @typedef {{ text: string, timestamp: [number, number | null] }} PipelineChunk */

/**
 * @typedef {
 *   | { type: 'load', model?: 'tiny' | 'base' | null }
 *   | { type: 'decode', id: string, pcm: Float32Array, prompt: string | null }
 * } ToWorker
 */

/**
 * @typedef {
 *   | { type: 'progress', p: number }
 *   | { type: 'loaded', device: 'webgpu' | 'wasm', model: string }
 *   | { type: 'load_failed', message: string }
 *   | { type: 'decoded', id: string, text: string, chunks: PipelineChunk[] }
 *   | { type: 'decode_failed', id: string }
 * } FromWorker
 */

let asr = null;
let device = /** @type {'webgpu' | 'wasm'} */ ('wasm');
let modelId = MODELS.tiny;

/** @param {string | null | undefined} preference 'tiny' | 'base' | null (auto) */
function pickModels(preference) {
  if (preference === 'tiny' || preference === 'base') {
    return { webgpu: MODELS[preference], wasm: MODELS[preference] };
  }
  const ua = String(globalThis.navigator?.userAgent ?? '');
  const phone = /Android|iPhone|iPad|Mobi/i.test(ua);
  return { webgpu: phone ? MODELS.tiny : MODELS.base, wasm: MODELS.tiny };
}

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

/** @param {string | null} [preference] */
async function loadPipeline(preference = null) {
  if (asr) {
    self.postMessage(/** @type {FromWorker} */ ({ type: 'loaded', device, model: modelId }));
    return;
  }
  const choice = pickModels(preference);
  const opts = {
    progress_callback: (info) => {
      self.postMessage(/** @type {FromWorker} */ ({ type: 'progress', p: progress01(info) }));
    },
  };
  try {
    asr = await pipeline('automatic-speech-recognition', choice.webgpu, {
      ...opts,
      device: 'webgpu',
    });
    device = 'webgpu';
    modelId = choice.webgpu;
  } catch {
    asr = await pipeline('automatic-speech-recognition', choice.wasm, {
      ...opts,
      device: 'wasm',
    });
    device = 'wasm';
    modelId = choice.wasm;
  }
  self.postMessage(/** @type {FromWorker} */ ({ type: 'loaded', device, model: modelId }));
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
      max_new_tokens: Math.max(MIN_NEW_TOKENS, Math.ceil((pcm.length / 16000) * TOKENS_PER_SEC)),
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
      await loadPipeline(msg.model ?? null);
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

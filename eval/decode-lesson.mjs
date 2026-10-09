// Decode lessons/sample/lesson-clean.wav with the live Whisper options and
// score the text with eval/wer.mjs. This is a measurement harness, not the
// browser page. Node has no WebGPU. The script tries the worker's device
// order and records which one actually loads.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { buildHotwordPrompt } from '../web/hotwords.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'Xenova/whisper-tiny';
const SAMPLE_RATE = 16000;
const PROMPT_TOKEN_CAP = 223;
const WAV = join(ROOT, 'lessons/sample/lesson-clean.wav');
const LABELS = join(ROOT, 'lessons/gold/lesson-clean.labels.txt');
const GOLD = join(ROOT, 'lessons/gold/lesson-clean.transcript.txt');
const HOTWORDS = join(ROOT, 'lessons/hotwords/lesson.txt');
const OUT = join(ROOT, 'eval/runs/p1-lesson-clean');

const CONDITIONS = [
  { id: 'tiny-tl', language: 'tl', hotwords: false },
  { id: 'tiny-unset', language: null, hotwords: false },
  { id: 'tiny-en', language: 'en', hotwords: false },
  { id: 'tiny-tl-hotwords', language: 'tl', hotwords: true },
];

const smoke = process.argv.includes('--smoke');

function readPcm16(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a wav');
  let off = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(start + 2);
      rate = buf.readUInt32LE(start + 4);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === 'data') {
      data = buf.subarray(start, start + size);
    }
    off = start + size + (size % 2);
  }
  if (channels !== 1 || rate !== SAMPLE_RATE || bits !== 16 || !data) {
    throw new Error(`expected 16 kHz mono 16-bit wav, got ${channels} ch ${rate} Hz ${bits} bit`);
  }
  const pcm = new Float32Array(data.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return pcm;
}

function loadSpans() {
  const labels = readFileSync(LABELS, 'utf8').trim().split('\n');
  const gold = readFileSync(GOLD, 'utf8').trim().split('\n');
  if (labels.length !== gold.length) {
    throw new Error(`label lines ${labels.length} != gold lines ${gold.length}`);
  }
  return labels.map((line, index) => {
    const match = line.match(/^(\d+(?:\.\d+)?)\t(\d+(?:\.\d+)?)\t\[(TL|EN|MIX)\] (.*)$/);
    if (!match) throw new Error(`bad label line ${index + 1}`);
    const text = match[4];
    if (text !== gold[index]) throw new Error(`gold line ${index + 1} does not match the label text`);
    return {
      index,
      startSec: Number(match[1]),
      endSec: Number(match[2]),
      label: match[3],
      gold: text,
    };
  });
}

function sliceSpan(pcm, span) {
  const a = Math.round(span.startSec * SAMPLE_RATE);
  const b = Math.round(span.endSec * SAMPLE_RATE);
  return pcm.slice(a, b);
}

function decoderInputIds(tokenizer, prompt) {
  const encode = (s) => Array.from(tokenizer.encode(s, { add_special_tokens: false }));
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

function generateOptions(condition, tokenizer, prompt) {
  const gen = {
    return_timestamps: 'word',
    chunk_length_s: 30,
    task: 'transcribe',
  };
  if (condition.language) gen.language = condition.language;
  if (condition.hotwords) gen.decoder_input_ids = decoderInputIds(tokenizer, prompt);
  return gen;
}

function onnxNames(dir) {
  const found = [];
  const walk = (current) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.onnx')) found.push(path);
    }
  };
  if (dir) walk(dir);
  return found;
}

async function loadEngine() {
  const seen = [];
  const attempts = [];
  const callback = (info) => {
    if (info && typeof info === 'object' && info.file) seen.push(String(info.file));
  };
  for (const device of ['webgpu', 'wasm', 'cpu']) {
    const started = performance.now();
    try {
      const asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device,
        progress_callback: callback,
      });
      return {
        asr,
        device,
        loadMs: Math.round(performance.now() - started),
        files: [...new Set(seen)],
        attempts,
      };
    } catch (error) {
      attempts.push({ device, message: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error(`no device loaded: ${JSON.stringify(attempts)}`);
}

function writeText(name, lines) {
  writeFileSync(join(OUT, name), `${lines.join('\n')}\n`);
}

function scoreFile(reference, hypothesis, label) {
  const run = spawnSync(
    process.execPath,
    ['eval/wer.mjs', reference, hypothesis, label],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (run.status !== 0) {
    throw new Error(run.stderr || `wer.mjs failed for ${label}`);
  }
  return JSON.parse(run.stdout);
}

const pcm = readPcm16(WAV);
const spans = loadSpans();
const terms = readFileSync(HOTWORDS, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
const prompt = buildHotwordPrompt(terms);
if (!prompt) throw new Error('hotword list is empty');

const cacheBefore = onnxNames(env.cacheDir);
const engine = await loadEngine();
const cacheAfter = onnxNames(env.cacheDir);
const conditions = smoke ? CONDITIONS.slice(0, 1) : CONDITIONS;
const spanList = smoke ? spans.slice(0, 1) : spans;

const repeat = await (async () => {
  const audio = sliceSpan(pcm, spanList[0]);
  const gen = generateOptions(conditions[0], engine.asr.tokenizer, prompt);
  const started = performance.now();
  const first = await engine.asr(audio, gen);
  const firstMs = Math.round(performance.now() - started);
  const again = performance.now();
  const second = await engine.asr(audio, gen);
  const secondMs = Math.round(performance.now() - again);
  return {
    first: String(first?.text ?? '').trim(),
    second: String(second?.text ?? '').trim(),
    firstMs,
    secondMs,
  };
})();

/** @type {Record<string, { spans: { index: number, label: string, text: string, latencyMs: number }[] }>} */
const decoded = {};
for (const condition of conditions) {
  const gen = generateOptions(condition, engine.asr.tokenizer, prompt);
  const rows = [];
  for (const span of spanList) {
    const audio = sliceSpan(pcm, span);
    const started = performance.now();
    const out = await engine.asr(audio, gen);
    const latencyMs = Math.round(performance.now() - started);
    const text = typeof out?.text === 'string' ? out.text.trim() : '';
    rows.push({ index: span.index, label: span.label, text, latencyMs });
    process.stderr.write(`${condition.id} ${span.index} ${span.label} ${latencyMs}ms ${text}\n`);
  }
  decoded[condition.id] = { spans: rows, generate: gen.language ?? null, hotwords: condition.hotwords };
}

mkdirSync(OUT, { recursive: true });
const scores = [];
for (const condition of conditions) {
  const rows = decoded[condition.id].spans;
  const byIndex = new Map(rows.map((row) => [row.index, row.text]));
  const lines = spans.map((span) => byIndex.get(span.index) ?? '');
  writeText(`${condition.id}.txt`, smoke ? lines.slice(0, 1) : lines);
  if (!smoke) {
    for (const label of ['TL', 'EN', 'MIX']) {
      const picked = spans.filter((span) => span.label === label);
      writeText(`${condition.id}.${label}.hyp.txt`, picked.map((span) => byIndex.get(span.index) ?? ''));
      writeText(`${condition.id}.${label}.gold.txt`, picked.map((span) => span.gold));
    }
    const whole = scoreFile(GOLD, join(OUT, `${condition.id}.txt`), condition.id);
    const parts = {};
    for (const label of ['TL', 'EN', 'MIX']) {
      parts[label] = scoreFile(
        join(OUT, `${condition.id}.${label}.gold.txt`),
        join(OUT, `${condition.id}.${label}.hyp.txt`),
        `${condition.id}-${label}`,
      );
    }
    scores.push({ id: condition.id, whole, parts });
  }
}

const later = decoded[conditions[0].id].spans.slice(1).map((row) => row.latencyMs);
const meta = {
  model: MODEL_ID,
  package: '4.3.1',
  device: engine.device,
  loadMs: engine.loadMs,
  deviceAttempts: engine.attempts,
  progressFiles: engine.files,
  onnxBefore: cacheBefore,
  onnxAfter: cacheAfter,
  cacheDir: env.cacheDir,
  hotwordPrompt: prompt,
  determinism: {
    match: repeat.first === repeat.second,
    first: repeat.first,
    second: repeat.second,
    firstMs: repeat.firstMs,
    secondMs: repeat.secondMs,
  },
  firstSpanAfterLoadMs: repeat.firstMs,
  sameSpanAgainMs: repeat.secondMs,
  laterDecodeMs: later,
  note: 'Spans are the human label times, not the live VAD cuts. loadMs is pipeline() including the weight download when the cache was empty. firstSpanAfterLoadMs is the first generate after that load. laterDecodeMs are the remaining spans of the first condition, model already loaded.',
  decoded,
  scores,
};
writeFileSync(join(OUT, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ device: meta.device, loadMs: meta.loadMs, scores, determinism: meta.determinism.match }, null, 2)}\n`);

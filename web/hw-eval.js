/** @typedef {import('../contracts.ts').AsrEngine} AsrEngine */
/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */

const GOLD_PATH = 'lessons/gold/lesson-clean.transcript.txt';

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const s = String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’-]+/gu, ' ')
    .trim();
  return s ? s.split(/\s+/) : [];
}

/**
 * Levenshtein distance over tokens, divided by gold length.
 * @param {string} hypothesis
 * @param {string} gold
 * @returns {number}
 */
export function wer(hypothesis, gold) {
  const hyp = tokenize(hypothesis);
  const ref = tokenize(gold);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const dp = new Uint32Array(rows * cols);
  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      const del = dp[(i - 1) * cols + j] + 1;
      const ins = dp[i * cols + (j - 1)] + 1;
      const sub = dp[(i - 1) * cols + (j - 1)] + cost;
      dp[i * cols + j] = Math.min(del, ins, sub);
    }
  }
  return dp[ref.length * cols + hyp.length] / ref.length;
}

/**
 * @param {string} path
 * @returns {Promise<string | null>}
 */
export async function readGold(path) {
  const fromDisk = await readGoldFile(path);
  if (fromDisk !== undefined) return fromDisk;
  const res = await fetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gold transcript fetch failed (${res.status})`);
  return res.text();
}

/**
 * @param {string} path
 * @returns {Promise<string | null | undefined>} undefined when node:fs is unavailable
 */
async function readGoldFile(path) {
  let readFile;
  try {
    ({ readFile } = await import('node:fs/promises'));
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : '';
    if (code && code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw err;
    return undefined;
  }
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * @param {TranscriptSegment} seg
 * @returns {string}
 */
function hypothesisFrom(seg) {
  const words = [];
  for (const w of seg.words ?? []) {
    if (w.text) words.push(w.text);
  }
  if (words.length) return words.join(' ');
  const alts = [];
  for (const g of seg.gaps ?? []) {
    if (g.reason?.alternatives?.length) alts.push(...g.reason.alternatives);
  }
  return alts.join(' ');
}

/** @param {TranscriptSegment} seg */
function engineFailureOnly(seg) {
  if ((seg.words ?? []).length) return false;
  return !(seg.gaps ?? []).some((g) => g.reason?.alternatives?.length);
}

/**
 * Before/after WER on the same PCM. Missing gold is reported, never invented.
 * @param {AsrEngine} engine
 * @param {Float32Array} pcm
 * @param {string[]} terms
 * @param {string} [goldPath]
 */
export async function measureHotwordBias(engine, pcm, terms, goldPath = GOLD_PATH) {
  const gold = await readGold(goldPath);
  if (gold == null) {
    return {
      goldMissing: true,
      goldPath,
      message: `${goldPath} is not there yet. Not inventing a gold transcript.`,
    };
  }
  const without = await engine.transcribe(pcm, {
    startSec: 0,
    hotwords: [],
    snrDb: 99,
    snrThresholdDb: 0,
  });
  const withHw = await engine.transcribe(pcm, {
    startSec: 0,
    hotwords: terms,
    snrDb: 99,
    snrThresholdDb: 0,
  });
  if (engineFailureOnly(without) || engineFailureOnly(withHw)) {
    const which =
      engineFailureOnly(without) && engineFailureOnly(withHw)
        ? 'both arms returned engine-failure gaps'
        : engineFailureOnly(without)
          ? 'baseline arm returned an engine-failure gap'
          : 'biased arm returned an engine-failure gap';
    return { goldMissing: false, unscorable: true, reason: which };
  }
  return {
    goldMissing: false,
    goldPath,
    terms: [...terms],
    werWithout: wer(hypothesisFrom(without), gold),
    werWith: wer(hypothesisFrom(withHw), gold),
  };
}

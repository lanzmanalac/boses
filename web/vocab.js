// vocab.js — Owner: P4.
// Small, deterministic term ranking. Only displayed words count: a gap's
// alternatives are uncertain and must never become study-sheet vocabulary.

/** @typedef {import('../contracts.ts').LessonSession} LessonSession */
/** @typedef {import('../contracts.ts').VocabItem} VocabItem */

const STOPWORDS = new Set([
  'a', 'ako', 'and', 'ang', 'are', 'at', 'ay', 'ba', 'by', 'din',
  'for', 'from', 'in', 'is', 'it', 'ito', 'may', 'mga', 'na', 'ng',
  'of', 'on', 'or', 'para', 'sa', 'si', 'sila', 'tayo', 'the',
  'this', 'to', 'we', 'with', 'you', 'yung',
]);

/** @param {string} text */
function tokens(text) {
  return String(text ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

/**
 * @param {LessonSession} session
 * @param {{maxItems?: number, stopwords?: string[], pairs?: {tl:string,en:string}[]}} [options]
 * @returns {VocabItem[]}
 */
export function extractVocab(session, { maxItems = 12, stopwords = [], pairs = [] } = {}) {
  if (!Number.isInteger(maxItems) || maxItems < 0) {
    throw new Error('maxItems must be a nonnegative integer');
  }
  const ignored = new Set([...STOPWORDS, ...stopwords.map((word) => word.toLocaleLowerCase())]);
  const counts = new Map();
  for (const segment of session?.segments ?? []) {
    for (const word of segment.words ?? []) {
      for (const token of tokens(word.text)) {
        if (token.length < 3 || ignored.has(token)) continue;
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }

  /** @type {VocabItem[]} */
  const items = [];
  const paired = new Set();
  // Pairs are supplied by a teacher or checked glossary. They are shown only
  // when both forms actually occur in the captured text.
  for (const pair of pairs) {
    const tl = tokens(pair.tl).join(' ');
    const en = tokens(pair.en).join(' ');
    if (!tl || !en || tl.includes(' ') || en.includes(' ') || tl === en ||
        paired.has(tl) || paired.has(en)) continue;
    const tlCount = counts.get(tl) ?? 0;
    const enCount = counts.get(en) ?? 0;
    if (!tlCount || !enCount) continue;
    paired.add(tl);
    paired.add(en);
    items.push({ term: tlCount >= enCount ? tl : en,
      count: tlCount + enCount, tl, en });
  }
  for (const [term, count] of counts) {
    if (!paired.has(term)) items.push({ term, count });
  }
  items.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return items.slice(0, maxItems);
}

// taglish.js — Owner: P4.
// Language labels are annotations only. Never translate or rewrite captions.

/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */

const TL_WORDS = new Set([
  'ako', 'ang', 'ay', 'ba', 'dahil', 'din', 'dito', 'gamit', 'ito',
  'kailangan', 'kaya', 'kung', 'may', 'mga', 'na', 'ng', 'nito',
  'para', 'sa', 'si', 'sila', 'tayo', 'tungkol', 'yung',
]);
const EN_WORDS = new Set([
  'a', 'and', 'are', 'because', 'by', 'for', 'from', 'in', 'is',
  'it', 'of', 'on', 'or', 'the', 'this', 'to', 'we', 'with', 'you',
]);

/** @param {string} text */
export function normalizeToken(text) {
  return String(text ?? '').toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Return TL, EN, MIX, or null when a word is not in the known lexicons.
 * Unknown words stay unknown; guessing a language would be misleading.
 * @param {string} text
 * @param {{tlTerms?: string[], enTerms?: string[]}} [options]
 */
export function classifyWord(text, { tlTerms = [], enTerms = [] } = {}) {
  const token = normalizeToken(text);
  if (!token) return null;
  const tl = TL_WORDS.has(token) || tlTerms.some((term) => normalizeToken(term) === token);
  const en = EN_WORDS.has(token) || enTerms.some((term) => normalizeToken(term) === token);
  if (tl && en) return 'MIX';
  if (tl) return 'TL';
  if (en) return 'EN';
  // A Filipino affix joined to a known English term is visibly code-switched.
  const mixed = token.match(/^(?:nag|mag|pag)[-]?(.+)$/u);
  if (mixed && (EN_WORDS.has(mixed[1]) ||
      enTerms.some((term) => normalizeToken(term) === mixed[1]))) return 'MIX';
  return null;
}

/**
 * Tag only displayed words, leaving the TranscriptSegment unchanged.
 * `label` is null when there is insufficient lexical evidence.
 * @param {TranscriptSegment} segment
 * @param {{tlTerms?: string[], enTerms?: string[]}} [options]
 */
export function tagSegment(segment, options = {}) {
  const spans = (segment.words ?? []).map((word) => ({
    start: word.start,
    end: word.end,
    text: word.text,
    label: classifyWord(word.text, options),
  }));
  const labels = new Set(spans.map((span) => span.label).filter(Boolean));
  const label = labels.size > 1 || labels.has('MIX')
    ? 'MIX'
    : (labels.values().next().value ?? null);
  return { label, spans };
}

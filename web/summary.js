// summary.js — Owner: P4.
// A deterministic, source-grounded overview. It does not invent lesson facts
// or pretend a transcript without decoder confidence is verified.

import { deriveCoverage } from './confidence.js';
import { extractVocab } from './vocab.js';

/** @typedef {import('../contracts.ts').LessonSession} LessonSession */

/**
 * @param {LessonSession} session
 * @returns {string[]}
 */
export function buildSummary(session) {
  const title = String(session?.title ?? '').trim() || 'Untitled lesson';
  const segments = session?.segments ?? [];
  const vocab = session?.vocab?.length ? session.vocab : extractVocab(session);
  const coverage = deriveCoverage(segments);
  const gapCount = segments.reduce((sum, segment) => sum + (segment.gaps?.length ?? 0), 0);
  const flagCount = session?.flags?.length ?? 0;

  const lines = [`Lesson topic: ${title}.`];
  if (vocab.length) {
    lines.push(`Terms appearing in the captured transcript: ${vocab.slice(0, 5)
      .map((item) => item.term).join(', ')}.`);
  }
  const excerpt = segments
    .filter((segment) => (segment.words?.length ?? 0) > 0)
    .sort((a, b) => b.words.length - a.words.length || a.start - b.start)[0];
  if (excerpt) {
    const text = excerpt.words.map((word) => word.text).join(' ').trim();
    const gapNote = excerpt.gaps?.length ? ' [unclear span omitted]' : '';
    lines.push(`Captured excerpt (unverified): “${text.slice(0, 160)}${text.length > 160 ? '…' : ''}”${gapNote}`);
  }
  lines.push(`${gapCount} unclear span${gapCount === 1 ? '' : 's'} and ${flagCount} student flag${flagCount === 1 ? '' : 's'} to review.`);
  if (coverage.totalSec > 0) {
    lines.push(`${Math.round(coverage.coverageRatio * 100)}% of marked transcript time passed audio-quality checks; the words remain unverified by decoder confidence.`);
  } else {
    lines.push('No transcript time was captured for this lesson.');
  }
  return lines;
}

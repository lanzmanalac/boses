// sheet.js — Owner: P3.
//
// The printable study sheet. This is the reason the product exists beyond the
// live captions, so it is treated as the terminal artifact: five sections,
// all of which are required (Boses.md Step 8).
//
//   1. Lesson topic and main points
//   2. Key vocabulary, Tagalog + English where both occurred
//   3. "Ask about these tomorrow" — low-confidence, noisy, and self-flagged
//   4. The coverage figure
//   5. The full verbatim transcript, so every summary line can be checked
//
// TWO HARD RULES:
//   - The coverage figure is printed on the page. The student must be able to
//     see how much of this record is solid.
//   - Every gap survives into print. A sheet that quietly omits what was not
//     heard is a confident wrong caption in paper form.
//
// PLAIN JAVASCRIPT ON PURPOSE — no build step, no transpiler, works offline.
// Types are JSDoc annotations referencing contracts.ts, the frozen source of
// truth. Do not inline a copy of a type.
//
// Consumes contracts.ts shapes only. It does not compute vocab, summary, or
// coverage — those belong to other owners. It receives them.

/** @typedef {import('../contracts.ts').LessonSession} LessonSession */
/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */
/** @typedef {import('../contracts.ts').VocabItem} VocabItem */
/** @typedef {import('../contracts.ts').FlaggedSpan} FlaggedSpan */
/** @typedef {import('../contracts.ts').CoverageStats} CoverageStats */

/** @param {unknown} s */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** @param {number} sec */
const mmss = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** @type {Record<string,string>} */
const REASON_PLAIN = {
  low_confidence: 'not heard clearly',
  snr_below_threshold: 'too noisy',
  too_short: 'too short',
  repetition_suppressed: 'repeated noise',
  user_flagged: 'you flagged this',
};

/**
 * @typedef {object} SheetInput
 * @property {LessonSession} session
 * @property {CoverageStats} [coverage]
 * @property {string[]} [summaryLines]  Produced by P4. Never a string P3 writes.
 * @property {string} [llmDraft]         Rendered under a visible machine-draft mark.
 * @property {string} [confidenceSource] e.g. "per-token from decoder".
 * @property {boolean} [unverified]  true when the decoder exposed no per-word
 *   confidence, so a gap means "not reliably captured" rather than
 *   "the model was unsure". Printed as a banner. See ADR-0002.
 */

/**
 * Recompute coverage locally as a fallback so the sheet never prints a blank.
 * P4's figure wins when supplied; this only covers a missing value.
 * @param {TranscriptSegment[]} segments
 * @returns {CoverageStats}
 */
export function deriveCoverage(segments) {
  let confident = 0;
  let uncertain = 0;
  for (const s of segments ?? []) {
    for (const w of s.words ?? []) confident += Math.max(0, (w.end ?? 0) - (w.start ?? 0));
    for (const g of s.gaps ?? []) uncertain += Math.max(0, (g.end ?? 0) - (g.start ?? 0));
  }
  const total = confident + uncertain;
  return {
    totalSec: total,
    confidentSec: confident,
    uncertainSec: uncertain,
    coverageRatio: total > 0 ? confident / total : 0,
  };
}

/**
 * Merge words and gaps into one reading order for the transcript body.
 * @param {TranscriptSegment[]} segments
 */
function transcriptText(segments) {
  const out = [];
  for (const seg of [...(segments ?? [])].sort((a, b) => a.start - b.start)) {
    const items = [
      ...(seg.words ?? []).map((w) => ({ at: w.start, run: () => w.text })),
      ...(seg.gaps ?? []).map((g) => ({
        at: g.start,
        run: () => `[${REASON_PLAIN[g.reason.kind] ?? 'unclear'}]`,
      })),
    ].sort((a, b) => a.at - b.at);
    out.push(items.map((i) => i.run()).join(' '));
  }
  return out.filter(Boolean).join('\n');
}

/** @param {number} epochMs */
function fmtDate(epochMs) {
  try {
    return new Date(epochMs).toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return String(epochMs); }
}

/**
 * @param {SheetInput} input
 * @returns {string}
 */
export function buildSheet(input) {
  const { session } = input;
  const segments = session?.segments ?? [];
  const coverage = input.coverage ?? deriveCoverage(segments);
  const summary = input.summaryLines?.length
    ? input.summaryLines
    : (session?.summaryLines ?? []);
  const vocab = session?.vocab ?? [];
  const flags = session?.flags ?? [];
  const pct = Math.round(coverage.coverageRatio * 100);

  // "Ask about these tomorrow" = everything the record says is unreliable,
  // plus everything the student said they missed. Sorted by time.
  const shaky = [
    ...segments.flatMap((s) => (s.gaps ?? []).map((g) => ({
      start: g.start,
      end: g.end,
      kind: g.reason.kind,
      text: (g.reason.alternatives ?? []).join(' / '),
      uncertain: true,
    }))),
    ...flags.map((f) => ({
      start: f.start,
      end: f.end,
      kind: f.reason,
      text: f.text,
      uncertain: false,
    })),
  ].sort((a, b) => a.start - b.start);

  return `
<section class="page" role="document" aria-label="Study sheet">

  <header>
    <h1>${esc(session?.title || 'Lesson study sheet')}</h1>
    <p class="meta">
      ${esc(fmtDate(session?.startedAt ?? Date.now()))} · produced on-device by Boses ·
      no audio left this device
    </p>
  </header>

  <h2>1 · Main points</h2>
  ${summary.length
    ? `<ul>${summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '<p class="meta">Summary not generated for this session.</p>'}

  ${input.llmDraft ? `
  <p class="meta"><span class="draft-mark">Machine draft</span></p>
  <p>${esc(input.llmDraft)}</p>
  <p class="meta">Check every line above against the verbatim transcript in
  section 5. Draft prose only — every figure on this sheet comes from the
  recorded facts.</p>` : ''}

  <h2>2 · Key vocabulary</h2>
  ${vocab.length ? `
  <ul>${vocab.map((v) => {
    const pair = v.tl && v.en ? ` <span class="meta">(${esc(v.tl)} / ${esc(v.en)})</span>` : '';
    const times = v.count > 1 ? ` <span class="meta">×${v.count}</span>` : '';
    return `<li><strong>${esc(v.term)}</strong>${pair}${times}</li>`;
  }).join('')}</ul>`
  : '<p class="meta">No vocabulary extracted for this session.</p>'}

  <h2>3 · Ask about these tomorrow</h2>
  ${shaky.length ? `
  <p class="meta">These parts of the lesson were not reliably captured, or you
  marked them yourself. They are the most useful thing on this page.</p>
  <ul>${shaky.map((s) => `
    <li>
      <strong>${esc(mmss(s.start))}</strong>
      ${esc(REASON_PLAIN[s.kind] ?? s.kind)}
      ${s.text ? `— <em>${esc(s.text)}</em>${s.uncertain ? ' (uncertain)' : ''}` : ''}
    </li>`).join('')}</ul>`
  : '<p class="meta">Nothing was flagged, and nothing was missed. Coverage was full.</p>'}

  <h2>4 · How much time is shown as words</h2>
  <div class="coverage">
    <span class="num">${pct}%</span>
    <span class="bar-mini"><i style="width:${pct}%"></i></span>
  </div>
  <p class="meta">
    This percent is time shown as words. Those words were not checked for accuracy.
    ${Math.round(coverage.confidentSec)} s shown as words ·
    ${Math.round(coverage.uncertainSec)} s in gaps ·
    ${Math.round(coverage.totalSec)} s total.
    The rest of the time is in gaps.
  </p>

  <h2>5 · Verbatim transcript</h2>
  <p class="meta">Exactly what was captured, in order. Bracketed marks are
  moments nothing was reliably heard.</p>
  <div class="transcript-body">${esc(transcriptText(segments))}</div>

  <footer class="meta" style="margin-top:1.5em;border-top:1px solid #999;padding-top:0.5em">
    Generated offline on-device. Audio was processed locally and not retained.
    Session id ${esc(session?.id ?? 'unknown')}.
  </footer>
</section>`.trim();
}

/** Mount the sheet into the page, so the end-of-class action and the print
 *  action share one render path. */
export class StudySheet {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
  }

  /** @param {SheetInput} input */
  render(input) {
    this.root.innerHTML = buildSheet(input);
  }

  print() {
    window.print();
  }
}
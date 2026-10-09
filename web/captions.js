// captions.js — Owner: P3.
//
// Live caption display, large type, contrast, read-along pacing,
// "I missed this" flag capture, and the signal-quality HUD.
//
// DESIGN RULES THIS FILE IS NOT ALLOWED TO BREAK:
//
//  1. A gap is a THING TO SHOW, styled deliberately — not a string to be
//     interpolated. (ARCHITECTURE.md §3.6)
//  2. Uncertainty is never smoothed over. If `gaps` says we did not hear it,
//     the caption says we did not hear it, in plain language.
//  3. The view never auto-scrolls past a reader. New lines append; the
//     student controls position. (Boses.md Step 5)
//  4. Alternatives are always rendered as uncertain. A confident wrong
//     caption is worse than a visible gap — that is the whole product.
//
// PLAIN JAVASCRIPT ON PURPOSE. There is no build step in this project and
// there is no network in airplane mode, so nothing may require transpiling.
// Types live in JSDoc annotations pointing at contracts.ts, which is the
// single frozen source of truth. Do not inline a copy of a type — import it.
//
// Consumes contracts.ts shapes and never imports another person's module.
// If a teammate's file is missing, this file still runs: it degrades to a
// clear message instead of a blank screen.

/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */
/** @typedef {import('../contracts.ts').Gap} Gap */
/** @typedef {import('../contracts.ts').GapReason} GapReason */
/** @typedef {import('../contracts.ts').FlaggedSpan} FlaggedSpan */
/** @typedef {import('../contracts.ts').LessonSession} LessonSession */

/** Human-readable, honest wording per gap kind. Never "error". */
const GAP_WORDING = {
  low_confidence: 'not heard clearly',
  snr_below_threshold: 'too noisy to hear',
  too_short: 'too short to hear',
  repetition_suppressed: 'repeated noise, cut',
};

/**
 * Heavier conditions warrant a heavier visual. Escalation is visible.
 * @type {Record<string, string>}
 */
const GAP_ESCALATION = {
  low_confidence: 'gap gap--soft',
  snr_below_threshold: 'gap gap--hard',
  too_short: 'gap gap--soft',
  repetition_suppressed: 'gap gap--hard',
};

/**
 * @param {GapReason['kind'] | string} kind
 * @returns {string}
 */
export function reasonText(kind) {
  return Object.prototype.hasOwnProperty.call(GAP_WORDING, kind)
    ? GAP_WORDING[kind]
    : 'unclear';
}

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

// ─────────────────────────────────────────────────────────────────────────────
// CaptionRenderer
// ─────────────────────────────────────────────────────────────────────────────

export class CaptionRenderer {
  /** @param {HTMLElement} root */
  constructor(root, opts = {}) {
    /** @type {HTMLElement} */
    this.root = root;
    /** @type {TranscriptSegment[]} */
    this.segments = [];
    /** @type {FlaggedSpan[]} */
    this.flags = [];
    this.userScrolledAway = false;
    /** @type {(span: FlaggedSpan) => void} */
    this.onFlag = opts.onFlag;
    /** @type {(following: boolean) => void} */
    this.onPacingChange = undefined;

    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-atomic', 'false');
    this.root.setAttribute('aria-label', 'Live captions');

    // Pacing: if the reader scrolls up, we stop following. Re-engaging is
    // explicit, via the "jump to latest" button. Never yank the view back.
    this.root.addEventListener('scroll', () => {
      const atBottom =
        this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 48;
      if (!atBottom && !this.userScrolledAway) {
        this.userScrolledAway = true;
        this.emitPacing();
      } else if (atBottom && this.userScrolledAway) {
        this.userScrolledAway = false;
        this.emitPacing();
      }
    }, { passive: true });

    this.render();
  }

  /** true when the view is following the newest line. */
  get isFollowing() {
    return !this.userScrolledAway;
  }

  // ── data in ──────────────────────────────────────────────────────────────

  /** @param {TranscriptSegment} seg */
  appendSegment(seg) {
    // Append-only during a session (contracts.ts). Ignore a duplicate id
    // rather than rendering the same sentence twice.
    if (this.segments.some((s) => s.id === seg.id)) return;
    this.segments.push(seg);
    this.segments.sort((a, b) => a.start - b.start);
    this.render();
  }

  /** @param {FlaggedSpan} span */
  addFlag(span) {
    this.flags.push(span);
    this.render();
  }

  /** @returns {FlaggedSpan[]} */
  getFlags() {
    return [...this.flags];
  }

  /** @returns {TranscriptSegment[]} */
  getSegments() {
    return [...this.segments];
  }

  /** Load a whole session — used by the sheet view and by fixture mode. */
  loadSession(session) {
    this.segments = [...(session.segments ?? [])].sort((a, b) => a.start - b.start);
    this.flags = [...(session.flags ?? [])];
    this.render();
  }

  clear() {
    this.segments = [];
    this.flags = [];
    this.render();
  }

  // ── "I missed this" ──────────────────────────────────────────────────────
  // One tap, while the span is still on screen (Boses.md Step 5). Flags the
  // segment the reader is actually looking at; falls back to the newest.

  /** @param {FlaggedSpan['reason']} [reason] */
  flagVisible(reason = 'user_flagged') {
    const seg = this.visibleSegment() ?? this.segments[this.segments.length - 1];
    if (!seg) return null;

    const text = seg.words.map((w) => w.text).join(' ');
    /** @type {FlaggedSpan} */
    const span = {
      start: seg.start,
      end: seg.end,
      text: text || `(${reasonText(reason)})`,
      reason,
    };
    this.addFlag(span);
    return span;
  }

  visibleSegment() {
    const top = this.root.scrollTop + 8;
    const candidates = this.segments
      .map((s) => ({
        s,
        el: /** @type {HTMLElement|null} */ (
          this.root.querySelector(`[data-seg="${s.id}"]`)),
      }))
      .filter((c) => c.el)
      .map((c) => ({
        s: c.s,
        top: c.el.offsetTop,
        bottom: c.el.offsetTop + c.el.offsetHeight,
      }))
      .filter((c) => c.bottom > top);
    return candidates[0]?.s ?? null;
  }

  // ── pacing ───────────────────────────────────────────────────────────────

  emitPacing() {
    this.onPacingChange?.(this.isFollowing);
  }

  scrollToLatest() {
    this.userScrolledAway = false;
    this.root.scrollTop = this.root.scrollHeight;
    this.emitPacing();
  }

  // ── render ───────────────────────────────────────────────────────────────

  render() {
    if (this.segments.length === 0) {
      this.root.innerHTML =
        '<p class="seg" data-empty="true">' +
        '<span class="seg-meta">Captions will appear here as the lesson is heard. ' +
        'Anything not heard clearly is shown as a marked gap, not guessed at. ' +
        'Shown words passed a noise check and were not checked for accuracy.</span></p>';
      this.emitPacing();
      return;
    }

    const flagged = new Set(this.flags.map((f) => f.start));

    this.root.innerHTML = this.segments
      .map((seg) => {
        const body = this.mergedItems(seg)
          .map((it) => (it.gap ? this.renderGap(it.gap) : esc(it.text)))
          .join(' ');

        const bits = [];
        if (seg.engine && seg.engine !== 'fixture') bits.push(esc(seg.engine));
        if (seg.latencyMs) bits.push(`${seg.latencyMs} ms`);
        bits.push(`SNR ${Number(seg.snrDb).toFixed(1)} dB`);
        if (seg.words.length && seg.words.every((w) => w.conf === null)) bits.push('unverified');
        if (flagged.has(seg.start)) bits.push('flagged');

        return (
          `<p class="seg" data-seg="${esc(seg.id)}" data-flagged="${flagged.has(seg.start)}">` +
          `<span class="seg-time">${mmss(seg.start)}</span>${body}` +
          `<span class="seg-meta">${bits.join(' · ')}</span>` +
          `</p>`
        );
      })
      .join('');

    // Only follow when following. This single line is the pacing contract.
    if (this.isFollowing) {
      this.root.scrollTop = this.root.scrollHeight;
    }
    this.emitPacing();
  }

  /**
   * Interleave words and gaps on one timeline. A gap's words are *absent*
   * from `seg.words` by contract, so position is what orders them.
   * @param {TranscriptSegment} seg
   */
  mergedItems(seg) {
    const items = [
      ...seg.words.map((w) => ({ at: w.start, text: w.text })),
      ...seg.gaps.map((g) => ({ at: g.start, gap: g })),
    ].sort((a, b) => a.at - b.at);
    return items.map(({ at, ...rest }) => {
      void at;
      return rest;
    });
  }

  /** @param {Gap} gap */
  renderGap(gap) {
    const kind = gap.reason.kind;
    const title = `${reasonText(kind)} — ${mmss(gap.start)}–${mmss(gap.end)}`;
    // Alternatives are rendered as uncertain, never as a correction.
    const alt = gap.reason.alternatives && gap.reason.alternatives.length
      ? `<span class="gap-alt">maybe: ${esc(gap.reason.alternatives.join(' · '))} (uncertain)</span>`
      : '';
    return (
      `<span class="${GAP_ESCALATION[kind] ?? 'gap'}" role="note" title="${esc(title)}">` +
      `<span class="gap-label">[${esc(reasonText(kind))}]</span> ${alt}` +
      `</span>`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentation controls — type scale and contrast
// ─────────────────────────────────────────────────────────────────────────────

export const TYPE_MIN = 0.85;
export const TYPE_MAX = 2.4;

export class Presentation {
  /** @param {HTMLElement} [el] */
  constructor(el = document.documentElement) {
    this.el = el;
    this.scale = 1;
    /** @type {'high'|'standard'} */
    this.contrast = 'high';

    const saved = this.load();
    if (saved) {
      this.scale = typeof saved.scale === 'number' ? saved.scale : this.scale;
      this.contrast = saved.contrast === 'standard' ? 'standard' : 'high';
    }
    this.apply();
  }

  /** @param {number} v */
  setScale(v) {
    const n = Number(v);
    this.scale = Math.min(TYPE_MAX, Math.max(TYPE_MIN, Number.isFinite(n) ? n : 1));
    this.apply();
    this.save();
  }

  getScale() { return this.scale; }

  /** @param {'high'|'standard'} c */
  setContrast(c) {
    this.contrast = c === 'standard' ? 'standard' : 'high';
    this.apply();
    this.save();
  }

  getContrast() { return this.contrast; }

  toggleContrast() {
    this.setContrast(this.contrast === 'high' ? 'standard' : 'high');
    return this.contrast;
  }

  apply() {
    this.el.style.setProperty('--type-scale', String(this.scale));
    this.el.dataset.contrast = this.contrast;
  }

  save() {
    try {
      localStorage.setItem('boses.presentation', JSON.stringify({
        scale: this.scale, contrast: this.contrast,
      }));
    } catch { /* private mode — preferences just do not persist */ }
  }

  load() {
    try {
      const raw = localStorage.getItem('boses.presentation');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalQualityHUD
// ─────────────────────────────────────────────────────────────────────────────
// Answers one question continuously: is the app failing, or is the room loud?
// Without this, a student cannot tell a bug from a bad classroom.

/**
 * @typedef {object} QualitySnapshot
 * @property {boolean} [online]
 * @property {boolean} [capturing]
 * @property {number} [snrDb]
 * @property {number} [latencyMs]
 * @property {string} [engine]
 * @property {number} [progress]
 * @property {string} [note]
 */

export class SignalQualityHUD {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', 'Signal quality');
    this.render({});
  }

  /** @param {QualitySnapshot} s */
  render(s) {
    const chips = [];

    // Airplane mode is the intended state — present it as working.
    const online = s.online ?? navigator.onLine;
    chips.push(online
      ? '<span class="chip" data-state="warn" title="Online. Boses does not need a network.">online — not needed</span>'
      : '<span class="chip" data-state="offline">airplane mode</span>');

    chips.push(`<span class="chip" data-state="${s.capturing ? 'ok' : 'idle'}">${s.capturing ? 'listening' : 'paused'}</span>`);

    if (typeof s.snrDb === 'number') {
      // Bands match the default SNR gate; P2 owns the real threshold and can
      // tighten it. This is a UI affordance, not a second gate.
      const st = s.snrDb >= 15 ? 'ok' : s.snrDb >= 8 ? 'warn' : 'bad';
      chips.push(`<span class="chip" data-state="${st}" title="Estimated signal-to-noise ratio">SNR ${s.snrDb.toFixed(1)} dB</span>`);
    }

    if (typeof s.latencyMs === 'number') {
      chips.push(`<span class="chip" data-state="idle" title="Utterance close to caption ready">${Math.round(s.latencyMs)} ms</span>`);
    }

    if (s.engine) {
      chips.push(`<span class="chip" data-state="idle" title="Active engine">${esc(s.engine)}</span>`);
    }

    if (typeof s.progress === 'number' && s.progress < 1) {
      chips.push(`<span class="chip" data-state="warn">loading model ${Math.round(s.progress * 100)}%</span>`);
    }

    if (s.note) {
      chips.push(`<span class="chip" data-state="idle" style="width:100%">${esc(s.note)}</span>`);
    }

    this.root.innerHTML = chips.join('');
  }
}
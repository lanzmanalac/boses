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

/**
 * Order one segment's words and gaps on a single timeline. Exported so the
 * ordering can be checked without a DOM: a gap must never be rendered as if it
 * were heard text, and position is the only thing that orders the two.
 * @param {TranscriptSegment} seg
 * @returns {({text: string} | {gap: Gap})[]}
 */
export function mergeWordsAndGaps(seg) {
  const items = [
    ...(seg?.words ?? []).map((w) => ({ at: w.start, text: w.text })),
    ...(seg?.gaps ?? []).map((g) => ({ at: g.start, gap: g })),
  ].sort((a, b) => a.at - b.at);
  return items.map(({ at, ...rest }) => {
    void at;
    return rest;
  });
}

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
    // Guards the arrival animation: only a genuinely new segment should
    // animate in, never the whole transcript on a re-render.
    this.lastRenderedCount = 0;
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
      const distanceFromBottom =
        this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight;
      const atBottom = distanceFromBottom < 48;

      // A soft inset shadow appears when there is history above — it tells the
      // student "there is more up here" without spending a control on it.
      // Costs zero layout, and is written straight to the attribute so the
      // renderer never has to redraw the list for it.
      const scrolled = distanceFromBottom > 24;
      if (scrolled !== this.scrolledUp) {
        this.scrolledUp = scrolled;
        this.root.dataset.scrolled = String(scrolled);
      }

      if (!atBottom && !this.userScrolledAway) {
        this.userScrolledAway = true;
        this.emitPacing();
      } else if (atBottom && this.userScrolledAway) {
this.userScrolledAway = false;
    // Mirrors whether there is history above the viewport, for the scroll
    // shadow. Kept separate from userScrolledAway: those differ at the very
    // top of the transcript and again mid-buffer.
    this.scrolledUp = false;
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

    // Acknowledge IN PLACE. Previously the only feedback was a line in the
    // status bar several hundred pixels from the button, so a tap looked like
    // it had done nothing. More importantly, this is the one piece of motion
    // that is load-bearing: it confirms the span the student was actually
    // looking at is the span that got captured — the one thing in this UI
    // that can fail silently and mislead.
    const el = /** @type {HTMLElement|null} */ (
      this.root.querySelector(`[data-seg="${seg.id}"]`)
    );
    if (el) {
      // Restart the animation even if this span was already flagged once.
      el.classList.remove('was-flagged');
      void el.offsetWidth;
      el.classList.add('was-flagged');
      setTimeout(() => el.classList.remove('was-flagged'), 900);
    }
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
      // The first thing a student sees. Explain what will happen rather than
      // showing an empty box that looks broken.
      this.root.innerHTML =
'<div class="empty" data-empty="true">' +
        // A slow bracket breathe. Waiting must never look broken.
        '<span class="bracket" aria-hidden="true">[ &nbsp;]</span>' +
        '<h2>Captions will appear here.</h2>' +
        '<p>Start the lesson and hold the device where it can hear the teacher. ' +
        'Everything is processed on this device — nothing is uploaded.</p>' +
        '<p>Anything that could not be heard clearly is shown as a marked gap ' +
        'rather than guessed at, because a wrong caption you trust is worse ' +
        'than one that admits it is missing.</p>' +
        // Wording from the integration pass: name the limit in the first
        // screen a student sees, not only on the sheet at the end of class.
        '<p>Shown words passed a noise check and were not checked for accuracy.</p>' +
        '</div>';
      this.emitPacing();
      return;
    }

    const flagged = new Set(this.flags.map((f) => f.start));

    // Newest-first, bounded buffer: keep roughly the last CAPTION_BUFFER
    // segments so the newest text always lands at the same place on screen and
    // the eye never has to re-find it. Older lines fade out via the mask.
    //
    // Prune ONLY while following. If the student has scrolled up to re-read,
    // nothing is removed — dropping lines out from under a reader is exactly
    // the yank this product must never do (design rule 3).
    const cap = this.isFollowing
      ? Number(getComputedStyle(document.documentElement)
          .getPropertyValue('--caption-buffer')) || 6
      : this.segments.length;
    const shown = this.segments.slice(-Math.max(1, cap));

    // Only the genuinely NEWEST segment animates. render() rebuilds
    // innerHTML, so animating every .seg would re-animate the whole
    // transcript on every incoming line — the list would visibly blink.
    // newestId is set only when the segment count has actually grown.
    const newestId = this.segments.length > this.lastRenderedCount
      ? shown[shown.length - 1]?.id
      : undefined;
    this.lastRenderedCount = this.segments.length;

    this.root.innerHTML = shown
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
          `<p class="seg${seg.id === newestId ? ' is-new' : ''}"` +
          ` data-seg="${esc(seg.id)}" data-flagged="${flagged.has(seg.start)}">` +
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
    return mergeWordsAndGaps(seg);
  }

  /** @param {Gap} gap */
  renderGap(gap) {
    const kind = gap.reason.kind;
    const label = reasonText(kind);
    const span = `${mmss(gap.start)}–${mmss(gap.end)}`;
    // The reason MUST render as inline text. It used to live only in a title=
    // attribute, which is unreachable for this user three times over: touch
    // devices have no hover, screen readers handle title inconsistently, and
    // a student with low vision struggles to hover a small target at all.
    // The title is kept only as a supplement for sighted mouse users.
    //
    // Alternatives are rendered as uncertain, never as a correction. Both the
    // "maybe" prefix and the "(uncertain)" suffix are mandatory — remove
    // either and a guess becomes a suggestion, which is the exact failure this
    // product exists to prevent.
    const alt = gap.reason.alternatives && gap.reason.alternatives.length
      ? `<span class="gap-alt">maybe: ${esc(gap.reason.alternatives.join(' · '))} (uncertain)</span>`
      : '';
    return (
      `<span class="${GAP_ESCALATION[kind] ?? 'gap'}" role="note"` +
      ` aria-label="Unclear span from ${esc(span)}: ${esc(label)}"` +
      ` title="${esc(label)} — ${esc(span)}">` +
      `<span class="gap-label">[${esc(label)}]</span>${alt}` +
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
    /** @type {'paper'|'dimmed'} */
    this.theme = 'paper';
    /** @type {'standard'|'max'} Maximum separation is an override layer on
     *  top of either theme — it used to be the default, and is deliberately
     *  not any more. */
    this.contrast = 'standard';

    const saved = this.load();
    if (saved) {
      this.scale = typeof saved.scale === 'number' ? saved.scale : this.scale;
      this.theme = saved.theme === 'dimmed' ? 'dimmed' : 'paper';
      this.contrast = saved.contrast === 'max' ? 'max' : 'standard';
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

  /** @param {'paper'|'dimmed'} t */
  setTheme(t) {
    this.theme = t === 'dimmed' ? 'dimmed' : 'paper';
    this.apply();
    this.save();
  }

  getTheme() { return this.theme; }

  /** @param {'standard'|'max'} c */
  setContrast(c) {
    this.contrast = c === 'max' ? 'max' : 'standard';
    this.apply();
    this.save();
  }

  getContrast() { return this.contrast; }

  toggleContrast() {
    this.setContrast(this.contrast === 'max' ? 'standard' : 'max');
    return this.contrast;
  }

  apply() {
    this.el.style.setProperty('--type-scale', String(this.scale));
    this.el.dataset.theme = this.theme;
    this.el.dataset.contrast = this.contrast;
  }

  save() {
    try {
      localStorage.setItem('boses.presentation', JSON.stringify({
        scale: this.scale, theme: this.theme, contrast: this.contrast,
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
 * A tiny equaliser driven by the REAL capture level.
 *
 * This is a functional readout, not decoration: a captioning app showing no
 * sign of listening reads as broken, and the student cannot otherwise tell a
 * dead microphone from a quiet room. Bars are derived from levelDb, so they
 * move with the actual room rather than looping on a timer.
 *
 * aria-hidden — the SNR chip beside it states the same thing as text, so a
 * screen-reader user never has to hear a bar graph described.
 * @param {number|null} levelDb
 */
function meter(levelDb) {
  if (typeof levelDb !== 'number' || !Number.isFinite(levelDb)) return '';
  const bars = METER_KEYS
    .map(() => '<i style="height:4%"></i>')
    .join('');
  return `<span class="meter" data-state="idle" aria-hidden="true">${bars}</span>`;
}

/** Bar multipliers, tallest in the middle — an equaliser silhouette. */
const METER_KEYS = [0.45, 0.8, 1, 0.7, 0.35];

/** Map roughly 0..40 dB of level onto a 0..100% bar height. Deliberately not
 *  the SNR — this is how LOUD the room is, which is what "is it hearing me"
 *  actually means to the student. */
function levelPct(levelDb) {
  return Math.max(4, Math.min(100, (levelDb / 40) * 100));
}

/**
 * @typedef {object} QualitySnapshot
 * @property {boolean} [online]
 * @property {boolean} [capturing]
 * @property {number} [snrDb]
 * @property {number} [levelDb]   live capture level — drives the meter
 * @property {number} [latencyMs]
 * @property {string} [engine]
 * @property {number} [progress]
 * @property {string} [note]
 */

/** Small inline SVG. Decorative only — the chip's text carries the meaning.
 *  Inline rather than an icon font or sprite sheet: a missing asset in
 *  airplane mode is a missing affordance.
 *  NOTE: these MUST live at module scope. An earlier version had them inside
 *  the SignalQualityHUD class body, where `const` is a SyntaxError. That broke
 *  the whole module graph in index.html, so the inline script never ran and
 *  every button in the app silently died. */
const ico = (d) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

const ICONS = {
  plane: ico('<path d="M2 12h20M12 2v20M4 4l16 16M20 4L4 20"/>'),
  wifi:  ico('<path d="M5 12.5a10 10 0 0114 0M8.5 16a5.5 5.5 0 017 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/>'),
  mic:   ico('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3.5"/>'),
  pause: ico('<path d="M9 5v14M15 5v14"/>'),
  wave:  ico('<path d="M3 12h2l2-6 3 13 3-16 3 11 2-5h3"/>'),
  chip:  ico('<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>'),
  clock: ico('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>'),
};

export class SignalQualityHUD {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', 'Signal quality');
    this.lastHtml = null;
    this.render({});
  }

  /**
   * Update the level meter IN PLACE.
   *
   * render() replaces the strip's innerHTML, which would destroy and recreate
   * the meter bars every second — killing the CSS height transition and making
   * a 1Hz stutter instead of movement. The capture timer therefore calls this
   * instead of render(), and only calls render() when a text chip actually
   * changed. Cheaper too: no innerHTML churn at 1Hz on a low-end phone.
   *
   * @param {number|null} levelDb
   * @param {boolean} [active] false when paused — the meter breathes instead
   */
  setLevel(levelDb, active = true) {
    const el = /** @type {HTMLElement|null} */ (this.root.querySelector('.meter'));
    if (!el) return;
    if (typeof levelDb !== 'number' || !Number.isFinite(levelDb)) return;

    const pct = levelPct(levelDb);
    const bars = el.querySelectorAll('i');
    for (let i = 0; i < bars.length; i++) {
      bars[i].style.height = `${Math.round(pct * METER_KEYS[i])}%`;
    }
el.dataset.active = String(active);
    el.dataset.state = pct > 55 ? 'ok' : pct > 18 ? 'warn' : 'bad';
  }

  /**
   * @param {QualitySnapshot} s */
  render(s) {
    const chips = [];

    // Airplane mode is the intended state — present it as working.
    const online = s.online ?? navigator.onLine;
    chips.push(online
      ? `<span class="chip" data-state="warn" title="Online. Boses does not need a network.">${ICONS.wifi} online — not needed</span>`
      : `<span class="chip" data-state="offline">${ICONS.plane} airplane mode</span>`);

    chips.push(s.capturing
      ? `<span class="chip" data-state="listening">${meter(s.levelDb)}${ICONS.mic} listening</span>`
      : `<span class="chip" data-state="idle">${ICONS.pause} paused</span>`);

    if (typeof s.snrDb === 'number') {
      // Bands match the default SNR gate; P2 owns the real threshold and can
      // tighten it. This is a UI affordance, not a second gate.
      const st = s.snrDb >= 15 ? 'ok' : s.snrDb >= 8 ? 'warn' : 'bad';
      chips.push(`<span class="chip" data-state="${st}" title="Estimated signal-to-noise ratio">${ICONS.wave} SNR ${s.snrDb.toFixed(1)} dB</span>`);
    }

    if (typeof s.latencyMs === 'number') {
      chips.push(`<span class="chip" data-state="idle" title="Utterance close to caption ready">${ICONS.clock} ${Math.round(s.latencyMs)} ms</span>`);
    }

    if (s.engine) {
      chips.push(`<span class="chip" data-state="idle" title="Active engine">${ICONS.chip} ${esc(s.engine)}</span>`);
    }

    // ADR-0002: the decoder exposes no per-word confidence, so a gap here means
    // "not reliably captured" — NOT "the model felt unsure". This used to live
    // only as fine print on the study sheet, which made the product's central
    // honesty claim invisible during the one moment it matters. It is now
    // stated plainly and persistently. Softening this into "high accuracy"
    // anywhere would be a lie the product would then be telling.
    if (s.unverified) {
      // Two labels, one meaning. The full sentence is what a laptop user and
      // every screen reader need. On a phone the long form pushes the status
      // strip to three rows and eats the caption area, so the short form is
      // shown there instead — still honest, just not a paragraph. The same
      // sentence is stated in full on the setup callout either way.
      chips.push(
        '<span class="chip" data-state="unverified">' +
        '<span class="chip-full">Unverified text — audio checks passed, ' +
        'word confidence unavailable</span>' +
        '<span class="chip-short">Unverified text</span>' +
        '</span>'
      );
    }

    if (typeof s.progress === 'number' && s.progress < 1) {
      chips.push(`<span class="chip" data-state="warn">loading model ${Math.round(s.progress * 100)}%</span>`);
    }

    if (s.note) {
      chips.push(`<span class="chip" data-state="idle" style="width:100%">${esc(s.note)}</span>`);
    }

    // Skip the DOM write when nothing textual changed. The capture timer fires
    // this at 1Hz and most calls are no-ops; only a state or SNR change costs
    // a re-render. The level meter is updated separately, in place.
    const html = chips.join('');
    if (html !== this.lastHtml) {
      this.root.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
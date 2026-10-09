# Boses — UI/UX Design Specification

**Owner:** design lane (UI/UX)
**Status:** ready for the designer agent
**Companion file:** [`tokens.css`](./tokens.css) — merge into `web/styles.css`
**Applies to:** `web/index.html`, `web/captions.js`, `web/sheet.js`, `web/styles.css`

---

## 0. What this is

Boses captions a Taglish classroom lesson on-device and marks the parts it
could not hear, then prints the lesson as a study sheet. The primary user is a
deaf or hard-of-hearing Filipino student following a lesson as it happens.

**The one insight that governs every design decision below:** a deaf student
cannot audit a transcript the way a sighted user can glance at a screen and
check it against the audio. So a fluent, plausible, wrong caption is not a
minor error — it is something the student will trust completely and learn the
wrong thing from. A visible gap is *more useful than* a correct-looking
sentence.

Every rule in this document descends from that.

**Design direction: "academic paper."** A warm, paper-like light surface with
serif type for the caption stream. It reads as a study document rather than a
terminal, which matches the artifact the product ends with: a printed sheet.
The previous build's pure-black/neon-teal terminal aesthetic is superseded.

---

## 1. The five rules the UI may never break

These are not style preferences. A design that violates one of them is a
broken design, and they must survive any refactor.

**1. A gap is a thing to show, not a string to interpolate.**
Never `"[" + reason + "]"`. A gap is a rendered object with mass, a rule, a
texture, and its reason in plain language. (`ARCHITECTURE.md` §3.5, §3.6)

**2. Uncertainty is never smoothed over.**
If the system did not hear it, the UI says it did not hear it — in words a
student can act on. Not "error". Not a silent omission. Not a shortened
sentence.

**3. The view never yanks itself away from a reader.**
New captions append. If the student has scrolled up to re-read, the view
stays where they put it and offers an explicit "jump to newest" affordance.
Auto-scroll that outruns the reader is a bug, not a feature.

**4. Alternatives are always rendered as uncertain.**
A guessed word shown next to a gap must never be able to read as a correction.
It is prefixed "maybe" and suffixed "(uncertain)" or it does not ship.

**5. Nothing invents a number it cannot source.**
The coverage figure is the share of marked transcript time that passed
audio-quality checks — **not** word accuracy and **not** model confidence
(ADR-0002: the decoder exposes no per-word scores). If a number cannot be
sourced, it is not displayed.

> **Carry-forward warning.** `web/styles.css` and `web/captions.js` currently
> document *why* high contrast defaults on, why there are no web fonts, and
> why layout is 360px-first. Those comments are design rationale, not noise.
> If you rewrite those files, move the rationale here rather than deleting it —
> otherwise someone will later "fix" a deliberate decision.

---

## 2. Foundations

Merge [`tokens.css`](./tokens.css) into the `:root` of `styles.css`. Every
variable name from the existing `:root` block is preserved, so existing
consumers keep working.

### 2.1 Type

Three families, **all system stacks — no web fonts, ever**:

| Token | Stack | Use |
|---|---|---|
| `--font-ui` | system sans | Buttons, chips, chrome, metadata |
| `--font-caption` | Charter → Georgia → serif | **The caption stream**, headings |
| `--font-mono` | system mono, tabular figures | Timecodes, SNR, latency, coverage |

> **Why no web fonts.** Airplane mode is the normal operating condition. A font
> fetch that fails is a caption that does not render. This is an offline
> guarantee, not an aesthetic preference. Do not add `@font-face`.

`--type-scale` is **the only multiplier**. Every size token derives from it, so
one slider scales the entire interface — chrome and captions together. That is
what makes the accessibility control behave identically on a ₱4,000 Android
phone and a school laptop.

The caption size is `--step-caption`: **30px at scale 1**. This is the single
most important number in the system.

### 2.2 Themes

Three states, not two. The theme toggle and the contrast control are separate
concerns.

| State | Attribute | Appearance |
|---|---|---|
| Paper (default) | `[data-theme="paper"]` | Warm light `#F6F2EA`, ink `#211C16`, ink-blue accent |
| Dimmed paper | `[data-theme="dimmed"]` | Warm charcoal `#1C1A17` — **not** pure black |
| Maximum separation | `[data-contrast="max"]` | Pure black on pure white, heavy rules |

**Paper is tinted, never `#FFF`.** Pure white behind dense serif text causes
halation — dark text appears to smear — for low-vision readers. The tint also
survives a washed-out classroom projector.

**Dimmed paper, not `#000`:** it keeps the product identity coherent across
themes instead of reading as two different apps, and is less harsh than pure
black across a 40-minute class.

> **Note on a reversal.** Maximum-separation was the *default* in the previous
> build. It is now one deliberate step on a scale. Do not quietly move it back
> to default — that is a decision, not a starting point.

### 2.3 Non-negotiable constraints

1. **No build step, no framework.** Vanilla ES modules + CSS. A transpiler
   breaks the offline and low-end-device claims.
2. **No web fonts** (above).
3. **`--type-scale` remains a single root multiplier.**
4. **Touch targets ≥ 48px** (`--tap-min`).
5. **360px is the design target**, not an afterthought. Test at 360px wide.
   Portrait *and* landscape both work. Never lock orientation.
6. `prefers-reduced-motion` is handled in `tokens.css`. Nothing may be
   load-bearing for comprehension — captions must be fully readable with every
   duration set to 0.

---

## 3. The caption stream

### 3.1 Newest-first, bounded buffer

**Show roughly the last 6 segments. Older lines scroll off the top with a
soft fade mask.**

```css
--caption-buffer: 6;
--caption-fade-mask: linear-gradient(to bottom, transparent 0, var(--bg) 4rem);
```

This matches the phone guidance in `Boses.md` Step 5 ("keep the caption area to
roughly the last 4 lines and let it reflow") and keeps the **reading position
stable** — the newest text always lands at the same place on screen, so a
student's eye does not have to re-find it every few seconds.

> **Trade-off, recorded so nobody reverts it.** A bounded buffer means a long
> scroll-back history is not available on the live screen. The full record is
> not lost — it lives in the study sheet (§7) and Sessions (§6). This is a
> deliberate choice for the live view, not an oversight. Do not "fix" it back
> into an unbounded scrolling log.

### 3.2 Measure and rhythm

- `--caption-measure: 34ch` — long lines are genuinely hard to track when
  reading at speed from a desk. Drop the measure to `none` below 30rem, where
  the viewport is already narrow.
- `--caption-lead: 1.55` — captions are read aloud in the head; tight leading
  makes a partial line of type look like a different row.
- Each segment is a `<p class="seg">`, timecode then body.

### 3.3 Pacing

Follow-newest is **on by default**. If the student scrolls up:

- following disengages,
- a "↓ Jump to newest" button fades in (bottom-centred, shadowed so it reads
  over text),
- it does **not** re-engage until tapped.

`captions.js` already implements this via `isFollowing` / `onPacingChange`.
Preserve that behaviour exactly. It is rule 3.

### 3.4 Never animate caption arrival

A caption must not slide, fade, or typewriter in. The student reads from a
static position and motion moves it. `--dur-*` tokens exist for chrome
transitions only (the jump button, the settings sheet).

---

## 4. The gap system

**The most important section in this document.** It is the product's core
promise, and it is the first thing to be cut if the build is truncated.

### 4.1 Anatomy

A gap is a rendered object carrying **three simultaneous signals**:

```
│ ▓▓▓▓ not heard clearly ▓▓▓▓          ┌ heavy left rule  (4px, ochre)
└────────────────────────────────────   └ hatched fill     (diagonal, 135deg)
                                         └ plain-language reason
```

| Part | Token | Role |
|---|---|---|
| **Heavy left rule** | `--gap-rule-w: 4px` | The *shape* — visible at a glance, in peripheral vision, while listening |
| **Hatched fill** | `--gap-hatch-*` | The *mass* — a texture, not a tint |
| **Reason in words** | — | The *meaning* |

```css
.gap {
  display: inline-block;
  padding: var(--gap-pad-y) var(--gap-pad-x);
  border-left: var(--gap-rule-w) solid var(--gap-rule);
  border-radius: var(--gap-radius);
  background: var(--gap-fill);
  background-image: repeating-linear-gradient(
    var(--gap-hatch-angle),
    var(--gap-hatch) 0 2px,
    transparent 2px var(--gap-hatch-size)
  );
  color: var(--gap-ink);
  font-family: var(--font-ui);
  font-size: 0.72em;
  line-height: 1.4;
}
```

### 4.2 Why hatch, and why three signals

On the old dark theme a gap could *glow* amber and be unmistakable. On warm
paper, an amber tint alone reads as a **footnote or a highlighter mark** — it
disappears into the sentence. That would silently break the product's core
promise on its primary theme.

So a gap carries three signals, and the hatch earns its place on a second
count: **it survives greyscale printing**. A student who photocopies the study
sheet in black and white still sees every gap as a textured band. Colour alone
would vanish.

### 4.3 The reason is always visible text — never a tooltip

**This is a required fix.** `captions.js` currently renders the gap reason into
a `title=` attribute:

```js
`<span class="${…}" role="note" title="${esc(title)}">`
```

A `title` tooltip is unreachable for this user on three counts: touch devices
have no hover, screen readers handle it inconsistently, and a student who
cannot see well struggles to hover a small target at all.

**The reason must render as inline text.** The `title` may be *retained* as a
supplement for sighted mouse users, but it must never be the only carrier.

### 4.4 Reason vocabulary is fixed

Do not invent wording. These strings already exist in `captions.js` and in
`sheet.js` (`REASON_PLAIN`) and are used consistently across screen and print:

| `kind` | On screen | On the sheet |
|---|---|---|
| `low_confidence` | not heard clearly | not heard clearly |
| `snr_below_threshold` | too noisy to hear | too noisy |
| `too_short` | too short to hear | too short |
| `repetition_suppressed` | repeated noise, cut | repeated noise |
| `user_flagged` | — | you flagged this |

"you did not hear this" and "the app could not hear this" are **different
messages**, and the student is entitled to know which one it is. Preserve that
distinction.

### 4.5 Escalation is visible

Heavier conditions warrant a heavier visual — reuse the existing mapping from
`captions.js`:

```js
const GAP_ESCALATION = {
  low_confidence:        'gap gap--soft',
  snr_below_threshold:   'gap gap--hard',
  too_short:             'gap gap--soft',
  repetition_suppressed: 'gap gap--hard',
};
```

`.gap--hard` gets a full border and stronger hatch. Escalation must be
perceptible in peripheral vision, because the student is listening as well as
reading.

### 4.6 Alternatives

If `gap.reason.alternatives` is non-empty, render as:

```
[not heard clearly] maybe: chloroFIL · chlorine (uncertain)
```

Both the "maybe" prefix and the "(uncertain)" suffix are mandatory. Remove
either and a guess becomes a suggestion, which is the exact failure the product
exists to prevent (rule 4).

---

## 5. The live screen

### 5.1 Layout — state-based, chrome collapses

The previous build was one column doing five jobs — capture, captions,
controls, HUD, and lifecycle — all competing above the content. Restructure to
states that each own the whole viewport:

```
┌─────────────────────────────────┐
│ status strip          (§5.2)    │  always
├─────────────────────────────────┤
│                                 │
│      THE CAPTION STREAM         │  the entire remaining viewport
│                                 │
├─────────────────────────────────┤
│ [I missed this]  [End class]    │  two actions only
└─────────────────────────────────┘
        ↑ settings sheet slides up from here
```

- **Chrome recedes.** During a lesson the student needs the captions and two
  actions. Nothing else earns permanent space.
- **Settings collapse** into a pull-up sheet: type size, theme, contrast,
  follow-newest, hotword list. Opened by a single 48px target.
- **Lifecycle primary action is large and singular** — "Start lesson" owns the
  empty state; "End class" is the one footer action during a session.

### 5.2 The status strip — the honesty layer

A slim strip, always visible, answering continuously: *is the app failing, or
is the room loud?*

Without this, a student cannot tell a bug from a bad classroom — and both look
identical: captions stop.

```css
--strip-h: calc(2.5rem * var(--type-scale));
--strip-bg: var(--accent-quiet);
```

**Required content:**

| Element | Behaviour |
|---|---|
| Capture state | `listening` / `paused` |
| Signal quality | SNR in dB, banded ok / warn / bad |
| Network | `airplane mode` shown as **success**, not an error |
| Honesty tag | The unverified state (§5.3) |

Airplane mode is the **intended operating state**. The previous build already
renders it as a success chip (`data-state="offline"`) — keep that framing. It is
also the demo hook: the pitch is that turning off Wi-Fi changes nothing.

### 5.3 The unverified state

**ADR-0002 is the central honesty claim and it is currently buried** as
fine print in sheet section 4.

The decoder exposes no per-word confidence. So a gap here means *"this was not
reliably captured"* — **not** *"the model felt unsure."* Passing the audio
gate does **not** make the text correct. `confidence.js` stamps accepted words
with `conf: null` precisely so nothing downstream can pretend otherwise.

Surface this in the status strip, in plain words, persistently:

> Unverified text — audio checks passed, word confidence unavailable.

This is a **weakness stated up front**, and stating it is what makes the whole
product credible. It must not be softened into "high accuracy" anywhere.

### 5.4 "I missed this"

One tap, flags the segment the reader is *currently looking at*.

**Required discovery affordance.** The button is currently an unlabelled
action in a footer; nothing tells the student *why* to tap it or *what happens*.
Add a one-line helper, visible in the session state:

> Tap while the part you missed is on screen — it goes on tomorrow's sheet.

This is non-negotiable for rule 2 (uncertainty is never smoothed over) and
rule 5 (the flag is a claim the sheet will honour, so the user must know).

**Do not break the mechanism.** `flagVisible()` finds the segment via
`this.root.querySelector('[data-seg="<id>"]')` and its `offsetTop`. If you
change how segments are keyed, **flagging silently captures the wrong
segment.** See §8.

---

## 6. Setup and Sessions

### 6.1 Setup / pre-flight — *new screen*

**This does not exist yet and it is the first thing a judge sees.** Also the
first thing a real student sees.

Sequence, each step stating what it is and what happens next:

1. **What Boses is** — two sentences. On-device, works offline, marks what it
   could not hear. Plus the honest limitation up front (§5.3).
2. **Model download** — real progress with real numbers. "First run downloads
   the model (~40 MB). It is saved; every class after this works offline."
   Not a spinner.
3. **Microphone permission** — explain *before* the browser prompt, not after.
4. **Room calibration** — the P2 noise-floor step (`capture-check.html` shows
   "stay quiet for 1 second"). Say so.
5. **Lesson vocabulary** — see open question below.
6. **Start**

> `Boses.md` says "no setup wizard." That means no account, no configuration
> form, no onboarding gauntlet — not no explanation. A student who does not
> know the app needs the model downloaded *before* class must find out here,
> not during a lesson.

### 6.2 Sessions / history — *new screen*

`store.js` already exposes `getSession`, `deleteAllSessions`, and incremental
`appendSegment`. **Only the UI is missing.**

Each session card: title, date, duration, coverage %, flagged count.

**One-tap permanent deletion is a required feature and a demo beat**
(`Boses.md` §8, §9). Make the control unmissable, and make the confirmation
state the consequence plainly — deletion is **permanent and there is no undo**
(there is no cloud copy; there is no account). Do not use a generic "Are you
sure?" that hides what is being destroyed.

**Crash recovery:** segments are checkpointed to IndexedDB **as they arrive**
(`ARCHITECTURE.md` §3.7), so a phone that dies at minute 18 of a 20-minute
lesson must not lose the lesson. On launch, if an unfinished session exists,
offer to resume it — do not silently start a blank one.

---

## 7. The study sheet (print)

**In scope: the A4 print output. Out of scope: the on-screen phone preview —
see §9.**

Five sections, all required (`Boses.md` Step 8, `sheet.js`):

1. **Main points** — deterministic summary from P4. Never generated prose.
2. **Key vocabulary** — Tagalog/English pairs where both were spoken.
3. **Ask about these tomorrow** — gaps + student flags, by timecode. *The most
   valuable section on the page.*
4. **How much of this record is solid** — the coverage figure, printed.
5. **Verbatim transcript** — so every summary line can be checked.

Design requirements:

- **Every gap survives into print.** A sheet that quietly omits what was not
  heard is a confident wrong caption in paper form (rule 1, `sheet.js`).
- **Gaps use the same hatched treatment as the screen**, at
  `--print-hatch-opacity: 0.55` — heavier on paper, because a light hatch
  disappears in toner.
- **The coverage figure carries real weight.** The student must see how much of
  this record is solid *before* relying on it.
- **The `MACHINE DRAFT` mark stays** if an LLM draft is present.
- **The unverified banner stays** (§5.3) when `input.unverified` is true.
- Default 11.5pt defeats the purpose. `--step-print` is scaled by
  `--type-scale`; print at a readable size.

---

## 8. DOM contract — breaking this breaks the product

These are **load-bearing**, not decoration. Renaming any of them causes a
silent failure, not a visible error.

| Selector | Used by | If you change it |
|---|---|---|
| `#stage` | `index.html` end-class handler | `$('stage')` is `null` → **End class throws** |
| `#captions` | `CaptionRenderer` constructor | Renderer mounts nowhere → no captions |
| `#hud` | `SignalQualityHUD` | Status strip is dead |
| `#sheet` | `StudySheet` | Sheet never renders |
| `[data-seg="<id>"]` | `flagVisible()` | **Flagging captures the wrong segment, silently** |
| `.seg` | `visibleSegment()` | Visible-segment detection breaks |
| `--type-scale` on `<html>` | `Presentation.setScale()` | Type slider stops working |

The last one is the quiet killer: **`I missed this` will keep working, keep
tapping successfully, and flag the wrong text.** That is exactly the failure
this product exists to prevent.

When restructuring for §5.1, preserve all of these hooks even as the layout
changes.

---

## 9. Copy deck

Use these strings. `captions.js` already emits most of them; this deck fixes
the rest so nothing is invented at build time.

### Status strip

| State | Text |
|---|---|
| Capturing | `listening` |
| Idle | `paused` |
| Offline | `airplane mode` *(a success state)* |
| Online | `online — not needed` |
| Honesty tag | `Unverified text — audio checks passed, word confidence unavailable.` |

### Gap reasons — see §4.4, fixed vocabulary

### Actions

| Context | Label |
|---|---|
| Empty state | `Start lesson` |
| Live | `I missed this` · `End class` |
| Fixture mode | `Play recorded lesson` |
| Flag helper | `Tap while the part you missed is on screen — it goes on tomorrow's sheet.` |

### Settings sheet

`Type size` · `Contrast` · `Follow newest` · `Theme: paper / dimmed` ·
`Maximum separation` (toggle)

### Delete confirmation

`Delete all saved lessons? This cannot be undone. There is no copy anywhere
else — Boses keeps everything on this device only.`

### Setup — see §6.1

---

## 10. Acceptance checklist

Testable. Items 1–2 are the ones that matter most.

**Caption loop (must not regress)**
1. Segments render as captions.
2. `I missed this` flags **the segment currently in view** — verify by
   scrolling up, tapping, and checking the flag lands on what you were reading.
3. `End class` swaps to the sheet without throwing.

**Layout**
4. Usable at **360px** wide, portrait and landscape.
5. Touch targets ≥ 48px; the caption area stays legible with the type slider
   at maximum.

**Gap legibility**
6. A gap is identifiable **without hover** and **without reading the reason**
   (hatch + rule alone must suffice).
7. A gap still reads as a gap when the screen is **greyscale** — screenshot
   the page in greyscale and check.
8. A gap is still identifiable in a **greyscale printout**.

**Honesty**
9. No screen or sheet claims accuracy, confidence, or correctness the system
   cannot source (rule 5).
10. The unverified state is visible **without opening anything else**.

**Themes**
11. Paper, dimmed paper, and maximum separation all legible; gap treatment
    recognisable as the same object in all three.

**Resilience**
12. **Airplane mode** — load once online, then disconnect and reload. The
    caption loop must run.
13. `prefers-reduced-motion` — everything readable, nothing missing.

---

## 11. Cut order if the build is truncated

| Priority | What | Why |
|---|---|---|
| 1 | **Gap treatment** (§4) | The core promise. Amber-tint-on-paper would break it invisibly |
| 2 | **Type legibility** (§2.1, §3.2) | Legibility *is* the product |
| 3 | Status strip + unverified state (§5.2–5.3) | The credibility argument |
| 4 | Caption stream restructure (§5.1) | Real improvement, no promise at risk |
| 5 | Setup screen (§6.1) | First impression |
| 6 | Sessions screen (§6.2) | Delete is a demo beat |
| 7 | Sheet print restyle (§7) | Already functional |

**With only 1 and 2, the demo's core promise still lands visually.**

---

## 12. Open questions

Blocking nothing — each has a stated default.

1. **Hotword entry on setup** — read-only display of the auto-loaded list, or
   manual entry? *Default: read-only.* `lessons/hotwords/lesson.txt` already
   loads automatically; manual entry is new build work.
2. **Sessions screen depth** — full transcript inline, or summary + coverage +
   "open sheet"? *Default: summary + coverage + open sheet.*
3. **Per-stage local/remote indicator** — `Boses.md` §8 lists it as a
   must-have; nothing implements it. In scope? *Default: out of scope for this
   round*, revisit if time allows.
4. **Dimmed paper vs true black** — currently dimmed (§2.2). One token change
   if reversed.

---

## 13. Recorded non-goal

**The study sheet's on-screen phone preview is explicitly out of scope.**

Today `.sheet-view` is fixed to `max-width: 8.5in` with Georgia serif, which
is unusable on a phone. `Boses.md` states the sheet "must remain fully
readable on-screen if printing is unavailable" — so this is a **known gap
against the product spec**, recorded here deliberately rather than left as an
oversight.

**Owner:** the engineering lane. Flagged for the team. It is not a design
decision this round declined to make; it is a deferral, and it is written down
so nobody discovers it on Demo Day.
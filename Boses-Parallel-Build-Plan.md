# Boses — Parallel Build Plan

**How 4 people build Boses in 19.5 hours without ever waiting on each other.**

Companion to `Boses.md` (the product spec). This file is about **coordination only.**

---

**Companion documents:** `Boses.md` (product spec) and `ARCHITECTURE.md` (system architecture, ADRs, and the frozen interface contracts). Read `ARCHITECTURE.md` before T+0.30.

## 0. The core rule

> **Never wait for a person. Only ever wait for a file.**

If a task says "wait until X finishes," the task is written wrong. Every task below names the **file** it needs, and every one of those files will exist within the first 30 minutes regardless of anyone's progress.

Two mechanisms make this true:

1. **Contract freeze (T+0:30)** — all interfaces are written down and committed before any real code. Nobody asks "what will this return?" ever again.
2. **Fixture-first** — every module is developed against committed JSON fixtures, never against a teammate's live output. Code against the *interface*, not the *implementation*.

---

## 1. Timeline (hard numbers)

| Event | Time | Elapsed |
| --- | --- | --- |
| Briefing ends, building begins | **2:30 PM, Oct 9** | **T0** |
| Community check-in #1 | 6:00 PM | T3.5 |
| Community check-in #2 | 10:00 PM | T7.5 |
| Overnight | 12:00 AM – 6:00 AM | T9.5 – T15.5 |
| **Code freezes — no commits after** | **10:00 AM, Oct 10** | **T19.5** |
| Submission deadline (no extensions) | 10:00 AM, Oct 10 | T19.5 |

**19.5 hours. Not 30.** Every estimate below assumes that number.

---

## 2. The first 30 minutes (all hands, mandatory)

Nobody starts feature work until these six things exist. They are short and they unblock everything.

1. [ ] Create the **public** GitHub repo (must be public by the deadline — do it now, not later)
2. [ ] Create empty directories for every owner (section 4)
3. [ ] Commit `contracts.ts` from section 3 **verbatim** — do not redesign it, import it.
   Then **read it and agree it out loud** — it is frozen only once all four have accepted the shapes.
4. [ ] Create `lessons/fixtures/` with the three fixture files listed in section 5
5. [ ] Agree the module owner table (section 4) out loud in the chat
6. [ ] Post the two decision deadlines (section 8) in the chat so nobody is surprised later

**Timebox: 30 minutes. Hard stop even if unfinished.**

> ### Running it locally — nobody skips this
>
> These are web files. Browsers refuse to load them by double-clicking
> `index.html`, so a tiny local web server is required. From the repo root:
>
> ```
> python3 -m http.server 8000
> ```
>
> Then open `http://localhost:8000/web/index.html`. Add `?fixture=1` to the URL
> for the offline demo path that replays committed test data instead of loading
> the model.
>
> **Deploy it somewhere a judge can open it, not just on your laptop.** Decide
> the host early — the offline behaviour depends on it (see the scope note in
> `web/sw.js`). P4 owns the README and must include the run instructions above.

---

## 3. `contracts.ts` — the single most important file

**Committed at T+0:30 and frozen.** Every person codes against this. Changes require a heads-up in the chat, not a silent local edit.

```ts
// contracts.ts — FROZEN at T+0:30. Import this, don't copy it.
// If this is wrong, say so in chat and fix it here for everyone.

export type Confidence = number;      // 0..1, decoder-derived
export type EngineId = 'whisper-webgpu' | 'whisper-wasm' | 'fixture';

export interface GapReason {
  kind:
    | 'low_confidence'      // decoder confidence below threshold
    | 'snr_below_threshold' // segment too noisy — decoder was skipped entirely
    | 'too_short'           // segment shorter than a plausible word
    | 'repetition_suppressed'; // detected Whisper hallucination loop
  alternatives?: string[];  // ALWAYS rendered as uncertain in the UI
}

export interface Word {
  text: string;
  start: number;   // seconds from session start
  end: number;
  conf: Confidence;
}

export interface Gap {
  start: number;
  end: number;
  reason: GapReason;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  snrDb: number;         // estimated by capture — used by confidence gating
  words: Word[];         // LOW-CONFIDENCE WORDS ARE OMITTED FROM HERE
  gaps: Gap[];           // and represented here instead
  engine: EngineId;
  latencyMs: number;     // utterance close -> segment ready
}

export interface TranscribeOptions {
  startSec: number;
  hotwords: string[];
  snrDb: number;
  snrThresholdDb: number;
}

export interface AsrEngine {
  readonly id: EngineId;
  init(onProgress?: (p: number) => void): Promise<void>;
  transcribe(pcm: Float32Array, opts: TranscribeOptions): Promise<TranscriptSegment>;
  dispose(): Promise<void>;
}

export interface FlaggedSpan {
  start: number;
  end: number;
  text: string;
  reason: 'user_flagged' | GapReason['kind'];
}

export interface VocabItem {
  term: string;
  count: number;
  tl?: string;      // paired Filipino form if both were spoken
  en?: string;      // paired English form if both were spoken
}

export interface LessonSession {
  id: string;
  startedAt: number;             // epoch ms
  title: string;
  segments: TranscriptSegment[]; // append-only during the session
  flags: FlaggedSpan[];          // "I missed this"
  vocab: VocabItem[];            // filled at session end
  summaryLines: string[];        // deterministic template output
  llmDraft?: string;             // optional, cosmetic only
}

export interface CoverageStats {
  totalSec: number;
  confidentSec: number;   // segments transcribed with acceptable confidence
  uncertainSec: number;   // segments represented as gaps
  coverageRatio: number;  // confidentSec / totalSec
}
```

### The two decisions baked into this file

These are deliberate, not incidental:

- **`gaps` is a first-class field.** Uncertainty is part of the data model, not something the UI invents later. Every downstream module receives gaps as a first-class citizen, which is why the whole product keeps its core promise under noise.
- **`snrDb` lives on every segment.** Noise handling is a *designed-in* field rather than a retrofit. Whoever builds confidence gating uses it from day one, and it falls out of the contract automatically for everyone else.

---

## 4. Ownership & directory boundaries

**Rule: nobody edits another person's directory.** Merge conflicts drop to nearly zero because files don't overlap.

| Person | Role | Owns (sole editor) | Fixtures they consume |
| --- | --- | --- | --- |
| **P1** | ML / model boundary | `web/asr.js`, `web/hotwords.js`, `web/hw-eval.js` | gold transcripts |
| **P2** | Audio production & capture | `web/capture.js`, `web/noise.js`, `lessons/**` (all audio, transcripts, hotword lists) | — (produces them) |
| **P3** | Live UI & print | `web/captions.js`, `web/sheet.js`, `web/sw.js`, `web/index.html`, `web/styles.css` | `*.fixture.json` |
| **P4** | Post-class, taglish, eval, submission | `web/confidence.js`, `web/taglish.js`, `web/vocab.js`, `web/summary.js`, `web/store.js`, `web/fixture.js`, `web/engine-select.js`, `eval/**`, `README.md`, `DISCLOSURES.md` | `*.fixture.json` |

**P4 also owns `web/engine-select.js` and `web/fixture.js`** — the single adapter that chooses between the real engine and the fixture engine, and the fixture engine itself. Nobody else touches either. This is what makes the swap invisible to P3.

> **Resolved ownership note (Checkpoint B).** Earlier drafts of this document gave `engine-select.js` to P3 in the code sample while the table gave it to P4. **P4 owns both files.** The sample below has been corrected. `fixture.js` was named in the sample but never assigned to anyone; it is P4's.

### Integration owner
**P3** is the integration owner: they run every merge checkpoint and keep `main` runnable. Everyone else branches; they merge.

---

## 5. Fixtures — the anti-blocking fuel

**Committed by T+1:00, produced by P2, consumed by everyone.**

| File | Contents | Unblocks |
| --- | --- | --- |
| `lessons/fixtures/clean.fixture.json` | 3 clean Taglish segments with realistic word confs and `snrDb` | caption UI, vocab, sheet |
| `lessons/fixtures/noisy.fixture.json` | Same content, low confs, low `snrDb`, and several `gaps` of each kind | confidence gating, noise.js, coverage stats |
| `lessons/fixtures/taglish.fixture.json` | TL / EN / MIX spans **sliced from the clean take** — no extra recording needed | taglish pass |
| `lessons/gold/lesson-clean.transcript.txt` | Hand-transcribed reference | **WER evaluation** |

**Two recordings, four fixture files.** Record the same Taglish lesson twice — once clean, once deliberately noisy — then derive the fixtures from them. Quality can improve all night; existence cannot.

**The fixture engine — what everyone codes against until the real model lands:**

```js
// web/engine-select.js — owned by P4
//
// NOTE FOR EVERYONE: browser files are PLAIN JAVASCRIPT. There is no build
// step and no transpiler, so nothing may need compiling before it runs —
// airplane mode is the normal operating condition. Type information goes in
// JSDoc comments that point at contracts.ts; nothing imports the contract file
// at runtime. Writing `import type`, `private x: string`, or `satisfies` inside
// a .js file makes the browser refuse to parse it and the page goes blank.
// contracts.ts remains the single source of truth for the agreed shapes.

import { WhisperEngine } from './asr';          // P1 delivers this
import { FixtureEngine } from './fixture';      // P4 delivers this

/** @type {import('../contracts').AsrEngine} */
let engine;

if (params.has('fixture')) {
  engine = new FixtureEngine();                // deterministic, instant, offline
} else {
  engine = new WhisperEngine();                // swaps in transparently when ready
}
export default engine;
```

**Consequence:** P3 and P4 can build the entire UI, vocabulary extraction, coverage stats, and print sheet on day one against fixtures — while P1 is still fighting WebGPU. **The demo UI is never blocked on the model working.**

### Fixture authoring note for P2
Your hand-transcription is **double value**: it produces the fixtures *and* it is the ground truth for evaluation. Do not skip it, and do not let anyone "transcribe later" — it will never happen.

---

## 6. The parallel schedule

Four lanes, running concurrently. Real-world check-in points are used as integration checkpoints.

### Phase 0 — Contract freeze · T0 → T0.5 · ALL HANDS
Freeze `contracts.ts`, create repo and directories, create the three fixture files as empty-but-valid JSON, agree ownership, post decision deadlines.

### Phase 1 — Parallel build · T0.5 → T3.5

| Person | Tasks | Blocked on anyone? |
| --- | --- | --- |
| **P1** | WebGPU spike: does `transformers.js` load and decode in-browser? | **No** |
| **P2** | Record 2 lessons (clean / noisy) of the same Taglish content, in a real room. Start `web/noise.js`: SNR estimate + gate + min-duration + loop suppression | **No** |
| **P3** | PWA shell, service worker, airplane-mode indicator, caption renderer vs. fixture | **No** |
| **P4** | Confidence gating + coverage stats vs. fixture; calibration harness | **No** |

### ▶ Checkpoint A · T3.5 (6:00 PM) — aligns with community check-in #1
Everyone merges to `main`. **15 minutes.** Verify `main` runs in airplane mode. Report one sentence: what works, what's blocked, are you stuck >45 min?

### Phase 2 — Hardening · T3.5 → T7.5

| Person | Tasks |
| --- | --- |
| **P1** | Verify **WASM fallback**; streaming utterance decode; **decision deadline for WebGPU-or-WASM at T4** |
| **P2** | Hand-transcribe both lessons; hotword lists; SNR sweep audio (clean/10/5/0 dB); **noise-floor calibration** so the VAD threshold is set per room |
| **P3** | Large type + contrast controls, caption pacing, "I missed this" flag, **live signal-quality indicator** |
| **P4** | Taglish TL/EN/MIX pass; vocabulary extraction; IndexedDB store + one-tap delete |

### ▶ Checkpoint B · T7.5 (10:00 PM) — aligns with community check-in #2
Merge, verify offline, **make the first cut decision using section 10's cut list.** This is the moment hotword biasing gets cut if it isn't working. Decide it here, not at T17.

### Phase 3 — Overnight · T7.5 → T12

| Person | Tasks |
| --- | --- |
| **P1** | Hotword conditioning + before/after WER measurement |
| **P2** | Remaining SNR-sweep transcriptions; refine noisy fixture; **hallucination-rate measurement under noise** |
| **P3** | **Printable study sheet** — the terminal artifact — verified at 360 px width, not just on a laptop viewport |
| **P4** | Deterministic summary template; optional LLM layer behind a flag |

### ▶ Checkpoint C · T12 (2:30 AM) · **Integration completeness gate**
Full end-to-end run on `main`. If the real ASR still does not work in-browser, **switch to the fallback path decided at T4** — do not keep experimenting. Time is the resource now.

### Phase 4 — Artifact production · T12 → T16

| Person | Tasks |
| --- | --- |
| **P1** | Latency numbers per device; **WER vs SNR curve + hallucination rate**; **record the backup demo video in airplane mode** |
| **P2** | Final audio assets; SNR numbers; demo script timing |
| **P3** | Integration polish; airplane-mode demo path; **device matrix run — one phone + one laptop**, noting which fell back to WASM |
| **P4** | Eval suite + published results; README; **DISCLOSURES.md**; submission form draft |

### ▶ Checkpoint D · T16 (6:30 AM) — **Feature freeze**
Nothing new after this. Only fixes. Write the submission text now, while you still have energy.

### Phase 5 — Rehearse & submit · T16 → T19.5
Demo rehearsal ×2 (T16:30, again T18), backup video verified playable, submission complete **well before T19.5**. Code freezes at T19.5. No commits after.

---

## 7. Why nothing blocks — task by task

The user's actual requirement, made explicit.

| Task | Normally blocked by | Actually blocked by | Start when |
| --- | --- | --- | --- |
| Build the caption UI | Model working | `contracts.ts` + fixtures | **T0.5** |
| Build vocabulary extraction | Live transcripts | Fixtures | **T0.5** |
| Build the printable sheet | Full pipeline running | `LessonSession` shape + fixture | **T1** |
| Taglish TL/EN/MIX logic | ASR output | Taglish fixture | **T1** |
| Confidence gating & coverage | Real confidences | Noisy fixture with `conf` + `gaps` | **T0.5** |
| Noise / SNR handling | Real audio | Noisy fixture carrying `snrDb` | **T1** |
| Evaluate WER | A working engine | **Gold transcript** (not the engine) | **T1.5** |
| Write the demo script | A finished product | The spec, section 12 of `Boses.md` | **T2** |
| Write README / disclosures | Nothing | Nothing | **T3** |
| Fill the submission form | Everything | Nothing | **T16** |

**Nine of ten tasks unblock at T+0.5 to T+2, before the model is anywhere near working.**

---

## 8. Decision deadlines (post these in the chat at T0.5)

Open questions get a deadline, so nobody sits waiting on an experiment.

| Question | Decide by | If not decided → default |
| --- | --- | --- |
| WebGPU or WASM? | **T4** | Commit to the WASM path |
| Which model size? (tiny vs base) | **T3** | `base` if it fits the demo device, else `tiny` |
| Keep hotword biasing? | **T7.5** (Checkpoint B) | **Cut it** |
| Is noise protection worth it? | **T7.5** (Checkpoint B) | Keep only SNR gate + min-duration + repetition guard |
| Keep the local LLM? | **T16** (Checkpoint D) | **Cut it** |
| Which device is the primary demo machine? | **T6** | The fastest machine available tonight, and re-test at T18 |

**Both phone and laptop are commitments, not options.** There is no third form factor and no device-support line item to cut. If the phone path is failing at T6, that is a problem to solve, not a feature to drop — the phone is the cheaper and more common of the two.

---

## 9. Working rules

1. **Branch per person, merge at checkpoints only.** `main` must always run. No drive-by merges.
2. **Never commit someone else's directory.** If you need a change there, message the owner.
3. **No new dependencies without asking.** Two people adding different versions of the same library at 3 AM is a real failure mode.
4. **Merge conflict on someone's files? Stop and ask them.** Don't resolve it unilaterally.
5. **Blocked >45 minutes? Say so loudly.** Then work on your own next task. Don't sit idle.
6. **Fixtures are committed before any code that consumes them.**
7. **Feature flags for optional layers**: `?fixture=1`, `?llm=0`. Toggle, don't delete.
8. **Only the cut-list owner (P4) decides cuts.** If your feature is on the list, you are not expected to save it — protect the three non-negotiables instead.

### The four non-negotiables
If everything is falling apart, cut in this order and protect these:
1. **Gap marking** — the product's core promise
2. **SNR gate** — what keeps that promise honest in a loud room
3. **"I missed this" flagging** — makes the artifact personalized
4. **The printable study sheet** — the reason the product exists

---

## 10. Cut list (in strict order)

Decide at Checkpoint B, not at T17.

| # | Cut | Why it's safe |
| --- | --- | --- |
| 1 | Local LLM summary | Cosmetic; deterministic template already works |
| 2 | Hotword biasing | A differentiator, not a prerequisite — captions work without it |
| 3 | Speaker-turn labeling | Nice-to-have |
| 4 | Taglish span-tagging (`TL`/`EN`/`MIX` labels) | Keep code-switched recognition itself; drop only the *labelling* |
| 5 | SNR sweep beyond clean + noisy | Report two conditions instead of a full curve |
| 6 | Parent-facing plain-language sheet | Second output format |

**Never cut:** the airplane-mode demo path, gap marking, the SNR gate, or the printable sheet.

**Not cuttable:** phone and laptop support. Both are commitments, and the T16:30 device matrix must show both working.

---

## 11. Integration checklist — run at every checkpoint

- [ ] Fresh clone of `main`, installed from scratch — does it work?
- [ ] **Airplane mode on** — does the full demo still run?
- [ ] Fixture mode (`?fixture=1`) still works — is the demo never dependent on a model loading in time?
- [ ] Caption legibility checked at **360 px width**, not just on a laptop viewport
- [ ] Public repo — a judge must be able to see it
- [ ] Every module reads `contracts.ts`, and nobody forked it
- [ ] No uncommitted changes sitting on anyone's machine

---

## 12. Risks specific to parallel work

| Risk | Early warning | Response |
| --- | --- | --- |
| WebGPU never works in-browser | Not resolved by T4 | Commit to WASM at T4. Do not keep experimenting |
| Noise handling gets cut as "not core" | Demo is running in a real room, so noise *will* hit it live | Keep the SNR gate + min-duration + loop guard as the non-negotiable floor; they are cheap and they are what keeps the gap promise honest |
| Integration hell at the end | Two people changed the same file | Directory ownership; no cross-edits; merge only at checkpoints |
| Audio collection runs late and blocks evaluation | Fixtures missing by T1 | Fixture files exist (even small) at T0.5 — quality can improve, existence cannot |
| P1 becomes the bottleneck | Everything downstream looks finished but nothing runs live | P1 works against fixtures from hour one and reports at every checkpoint |
| Gold transcripts never done | "We'll hand-label later" | Make it a P2 task at T1 with a hard deliverable; it is the eval's foundation |
| Demo machine lacks WebGPU on Demo Day | Only tested on your laptop | Test on a second device; **backup video recorded in airplane mode** |
| Only one device type ever gets tested | "It works on my laptop" | **Device matrix run at T16:30** — one phone and one laptop. The phone is the riskier of the two (WebGPU often absent, no printer, less battery), so test it first |
| Scope creep on optional features | LLM, avatar, translation appear in commits | Section 10 cut list; P4 decides; new features require removing something |

---

## 13. Communication rhythm

| When | What |
| --- | --- |
| **T0.5** | Ownership agreed, decision deadlines posted, `contracts.ts` frozen |
| **Every checkpoint** | 15 min: merge, run section 11, one status sentence each |
| **T3.5, T7.5** | Join the community check-ins; use them for the cut decision |
| **T12** | Completeness gate — no new features after this |
| **T16** | Feature freeze; submission text written |
| **T18** | Final rehearsal, repo verified public, everything submitted |

**Escalation:** if two people disagree on a contract for more than 15 minutes, the integration owner (P3) decides and moves on. Time spent debating an interface is time not spent building.

---

## 14. If you're building this alone

Collapse to one lane, but keep the sequence and the cut list intact:

1. **T0–0.5** Contract + repo (you still need this, even alone — it stops you from redesigning mid-build)
2. **T0.5–3.5** ASR in browser, WebGPU then **immediately** WASM fallback
3. **T3.5–6** Capture, VAD, streaming decode, caption display — the spine
4. **T6–8** Gap marking + confidence gating + coverage stats *(the core promise — do not skip)*
5. **T8–11** "I missed this" + IndexedDB + one-tap delete
6. **T11–14** Vocabulary + summary template
7. **T14–16** **Printable study sheet** *(terminal artifact)*
8. **T16–17.5** Eval + README + disclosures
9. **T17.5–19.5** Backup video, rehearsal, submit early

**Solo priority:** the spine and the three non-negotiables. A working caption loop with honest gaps beats a broad feature set every time.

---

## 15. Print this on the wall

```
CONTRACTS FROZEN AT T+0:30.
NEVER WAIT FOR A PERSON — ONLY FOR A FILE.
NOBODY EDITS ANOTHER PERSON'S DIRECTORY.
main MUST ALWAYS RUN IN AIRPLANE MODE.
GAP MARKING  +  SNR GATE  +  "I MISSED THIS"  +  PRINTABLE SHEET  =  NON-NEGOTIABLE.
CUTS AT CHECKPOINT B (T7.5), NOT AT T17.
TEST ON PHONE + LAPTOP BEFORE THE REHEARSAL.
SUBMIT EARLY. CODE FREEZES AT T19.5.
```
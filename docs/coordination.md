# Coordination notes

These notes used to sit in the repository root. The running page does not read them.
Current behavior is in `README.md` and `eval/RESULTS.md`. The sections below are the old build plan and status snapshots.

---

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
---

# Boses: remaining work and team acceptance run

Status after updating `main` to `5779297` on 2026-10-10. P1 now emits timed
`conf: null` words, P2's gate defaults to 16 dB, P3 connects the live gate,
storage, recovery, and deletion, and P4 has a live-word contract check and
`eval/score-run.mjs`. The local `node --test` run passes 68 checks. Real phone
and laptop acceptance results are still pending. The published 65.5% WER /
23.8% CER figure is a 113-word recorded-audio baseline, not a live result.

## Order of work

1. **Choose the final settings and targets.** P1 confirms model/language and
   hotwords; P2 confirms the active gate on each device; the team writes
   numeric targets before testing.
2. **Run the integrated app on the demo phone and laptop.** P2 checks capture,
   P3 checks captions, storage, and offline behavior, and P1 provides raw
   recognizer output for each run.
3. **Score and publish the runs.** P4 fills run manifests, runs
   `eval/score-run.mjs`, and updates the results and disclosures. The team
   repeats any failed check after its owner fixes the cause.

## P1 — recognition and raw output

### Remaining changes and handoff

- [ ] Compare the committed Tiny clean, Tiny noisy, and Base clean runs on
  equivalent human references. Investigate the high error rates and choose
  the final model, language, and hotword settings with the team.
- [ ] Save **raw** recognizer text and decode times for the final clean and
  noisy live runs. Give P4 the model ID, package version, runtime
  (WebGPU/WASM), settings, device, and output for each run.

### Checks and handoff

- [ ] On the actual phone and laptop, confirm clear decoded phrases produce
  displayable `conf: null` words and report whether WebGPU or WASM loaded.
- [ ] Confirm repetition, prompt echo, empty output, and timeout remain gaps
  in the live run. Note any word-time or segment-boundary failures.
- [ ] Give P4 the raw output files and a short note on remaining TL/EN/MIX
  errors. Recorded-audio decode runs do not replace live-path results.

## P2 — microphone, segmentation, and reference audio

### Changes

- [ ] Confirm the 16 dB SNR threshold, 0.3 s minimum speech, 0.5 s hangover,
  and first 1 s room calibration on the final laptop and phone. If a device
  needs a different setting, measure and document the reason before the team
  changes the default.
- [ ] Confirm `lesson-noisy.labels.txt` matches the noisy take word for word
  and give P4 its human reference. P2's provenance is now documented in
  `docs/P2-audio-capture.md`; confirm the rights/status of the external
  classroom-ambience audio before final disclosures.
- [ ] Share each final segment's start/end time, SNR, and pass/gap reason
  with P1 and P4 so a missing phrase can be traced to capture or recognition.

### Checks and handoff

- [ ] Speak the known script on each device after a quiet calibration second.
  Check that first syllables, pauses, and phrase endings are not clipped.
  Recheck the one clean-line clipped start and one 10 dB clipped end in the
  current `lessons/GATE-REPORT.md`.
- [ ] Repeat clean, noisy, and noise-only checks. Clear labeled speech should
  reach ASR; noise-only audio should send no segments to ASR. Report any
  rejected speech or accepted noise, including the active threshold.
- [ ] Give P4 the aligned audio, labels, and per-segment gate log.

## P3 — browser flow, captions, sheet, and offline behavior

### Remaining changes and handoff

- [ ] On the deployed build, fix any caption, storage, or service-worker
  failure found by the device checks below. The merged code now uses P2's
  16 dB default, shows a gap when the gate fails, saves the completed
  vocabulary/summary, and connects recovery and delete-all.
- [ ] Confirm the active SNR setting during the demo. A saved
  `boses.snrThresholdDb` value or `?snr=` query can override the default.
- [ ] Keep live captions and the printed sheet labeled **unverified**.
  Coverage describes audio-gate pass time, not model confidence or word
  accuracy.

### Checks and handoff

- [ ] In live mode (URL without `?fixture=`), confirm clear speech appears as
  words, noisy or failed segments appear as gaps, and the same gated segment
  reaches captions, the session, and the sheet.
- [ ] Start and end fixture and live lessons; verify flags, vocabulary,
  summary, and sheet rendering. Confirm a save failure is visible. Reload and
  recover a saved lesson, then delete it and confirm it cannot be recovered.
- [ ] On the actual demo host, warm the app/model cache and test a live phrase
  after an airplane-mode reload on both devices. Record any console or
  network errors for the team.

## P4 — reliability, evaluation, and submission evidence

### Remaining changes and handoff

- [ ] Have the team agree numeric targets before the final run and save them
  in the run manifest or `eval/targets.json`. The scorer is already merged.
- [ ] Assemble actual clean, noisy, and noise-only **live** run manifests from
  P1's raw output and P2's aligned gate logs. Use `eval/score-run.mjs` for
  raw WER/CER, human-labeled TL/EN/MIX slices, displayed coverage and gaps,
  no-speech hallucinations, and latency per device.
- [ ] Review P1's newly committed Base clean and Tiny noisy recorded-audio
  outputs separately from live-device results. Update `eval/RESULTS.md`,
  `README.md`, and `DISCLOSURES.md` with final evidence, sample sizes, and
  limits. Review and commit the current local documentation edits on your
  P4 branch before publishing.

### Checks and handoff

- [ ] Re-run `node --test` after further code changes (68 passed after this
  pull), then check fixture modes in a browser. Fixture replay tests the UI
  path; it does not measure recognition accuracy.
- [ ] Confirm low SNR, too-short audio, and repetition remain gaps while
  accepted words have `conf: null`. Compare the saved session with the sheet.
- [ ] Publish results with sample sizes and limitations. Complete remaining
  model/license, external audio, network, and device disclosures using the
  team's confirmed evidence.

## Team acceptance run

1. **Agree on targets.** Record the WER/CER and latency goals, allowed
   noise-only hallucination count, and minimum accepted coverage in
   `eval/targets.json` before the final run. Record the chosen commit,
   model/settings, hotwords, active gate threshold, host, phone, and laptop.
2. **Run local checks.** Run `node --test`, then play clean, noisy, and Taglish
   fixtures to inspect captions and the sheet. Do not count fixture words as
   recognition accuracy.
3. **Run live clear speech.** On each device, open the URL without
   `?fixture=`, allow the mic, stay quiet for the first second, and speak the
   same human-transcribed TL/EN/MIX script. Record microphone, SNR, raw ASR
   text, visible words/gaps, and caption latency.
4. **Run noise cases.** Use the clean, noisy, and noise-only recordings or
   equivalent controlled playback. Log every segment sent to ASR and every
   gap. Noise-only must not create invented displayed words; clear speech
   must not be silently discarded.
5. **Check the study sheet and storage.** Flag a phrase, end the class,
   compare captions with the sheet and saved session, refresh and recover it,
   then use delete-all and confirm the record is gone.
6. **Check airplane mode.** On the same device and origin, first cache the
   app and model online. Enable airplane mode, reload, capture a live phrase,
   and open the sheet. Record whether any required resource failed to load.
7. **Score and decide.** P4 fills one manifest per condition/device from
   `eval/runs/run-manifest.template.json` and runs `eval/score-run.mjs`
   against the agreed targets. Compare raw WER/CER, TL/EN/MIX slices,
   coverage, gaps, no-speech hallucinations, and latency. Assign any failure
   to P1 (wrong raw words), P2 (capture/gating), P3
   (display/storage/offline), or P4 (evaluation/labeling), then repeat the
   affected check after a fix.

The acceptance record belongs in `eval/RESULTS.md`. The final demo should
describe accepted captions as **unverified** because this engine does not
provide decoder word-confidence scores.

---

# Boses: team tasks and final transcription test

> Historical integration snapshot from before `main` reached `5779297`.
> P1's timed unverified words and P3's threshold, storage, recovery, and
> deletion wiring have since merged. See
> [Remaining work and team acceptance run](#boses-remaining-work-and-team-acceptance-run) for the
> current owner tasks and acceptance run.

## Current status

- P1–P4 code/data changes are on `main`; at the start of this review the checkout matched `origin/main`. This P4 pass now has four local, uncommitted documentation updates. The fixture fetch-binding fix is included in commit `c83a4df`—it is not waiting for a separate push.
- Live audio is wired **P2 capture → P1 recognizer → P4 gate/Taglish pass → P3 captions and session checkpoint**. The fixture, confidence, evaluation, ASR, and capture checks pass locally (`node --test`: 33 passed).
- P4's `gateSegment()` is called before rendering/checkpointing. The gate can create a visible gap or label retained text unverified; it cannot repair words the recognizer misheard.
- P1's committed clean-lesson WebGPU evaluation reports 65.5% WER / 23.8% CER for Tagalog + hotwords on 113 reference words. This uses human-timed spans rather than live VAD cuts; it is not end-to-end validation. See `eval/RESULTS.md`.
- P2's measured live gate settings are 16 dB SNR, 0.3 s minimum duration, and 0.5 s hangover. P3's live page currently defaults to 12 dB, so the value passed into capture and the post-ASR gate must be aligned to 16 dB.
- P3's End class currently finalizes storage before computing vocabulary/summary, and does not await the async save. Session recovery and the delete-all action are not connected in the UI yet. These are remaining P3 integration tasks.
- The `id="stage"` issue is fixed. The phone/laptop live path and airplane-mode behavior have not yet been manually verified.

## P1 — speech recognition

**Do:**

- Investigate wrong words in live captions. The recognizer is the part that turns audio into text.
- Compare its current Whisper Tiny / forced Tagalog settings with short Tagalog, English, and Taglish examples.
- Capture the raw ASR output and report which model/runtime ran (WebGPU or WASM) and its latency.
- Check hotword behavior and whether terms from P2’s lesson list reach the recognizer.

**Check:**

- Use the same known spoken sample each time, with a human transcript as reference.
- Compare raw model output with the human transcript using P4’s WER/CER tool.
- Confirm that the engine returns text and timestamps, and does not claim decoder word confidence.

**Done when:** P1 reports measured clean and Taglish results, the model/settings used, and any remaining recognition errors.

## P2 — microphone capture and noise handling

**Do:**

- Verify the selected microphone and that speech is not clipped or cut into awkward segments.
- Confirm the room calibration and SNR/minimum-duration thresholds using actual recordings.
- Keep the clean recording, noisy recording, noise-only recording, and human transcript aligned.
- In live tests, wait quietly through the first second after pressing Start; the segmenter uses that time to calibrate the room.

**Check:**

- Replay the clean, noisy, and noise-only recordings through the capture/noise logic.
- Record each segment’s duration, SNR, and whether it was passed to ASR or turned into a gap.
- Make sure clearly spoken phrases are not being dropped before P1 receives them.

**Done when:** P2 supplies confirmed thresholds and can show that clear speech reaches ASR while low-quality or noise-only segments are handled appropriately.

## P3 — live integration and interface

**Do:**

- Call P4’s `gateSegment()` after P1 returns a segment and before captions or storage receive it. Use thresholds confirmed by P2. Send the same gated result to the screen and store.
- Connect P4’s Taglish labels, vocabulary, and summary where those features are shown. Taglish labels should annotate recognized words, not rewrite them.
- Pass P2’s lesson hotwords to P1 if the app is meant to use them.
- Add `id="stage"` to the stage element (or update the code that looks it up) so **End class → sheet** works.
- Make the sheet say **unverified** when decoder confidence is unavailable.
- Verify the service worker caches the app and needed model/runtime files for the chosen host.

**Check:**

- Start and end lessons in both fixture and live modes.
- Confirm captions, gaps, flags, storage, and the study sheet work.
- Check the browser console for errors, and verify the offline cache on the actual demo host.

**Done when:** a live session renders the gated text, saves it, and produces the study sheet without console errors.

## P4 — evaluation and reliability

**Do:**

- Keep `eval/RESULTS.md`, `README.md`, and `DISCLOSURES.md` aligned with the committed evidence. P1's raw clean-lesson scores and P2's separate gate report are now recorded.
- Keep the fixture fetch fix as merged; no follow-up branch is needed for that change.
- Confirm with P3 that accepted live words stay explicitly **unverified**, and that final storage includes the computed vocabulary/summary.
- Complete actual browser/device measurements after P3 fixes the 12 dB threshold and finalization/recovery/delete wiring.

**Check:**

- Local checks pass: `node --test` (33/33). Re-run after changes.
- The checks cover fixture replay, confidence gating, evaluation, ASR behavior, and P2 capture/noise guards; low-SNR, short, and repetition-detected segments become gaps.
- Keep fixture replay, P2 gate coverage, and P1 raw recognition accuracy as separate evidence in reports.

**Done when:** evaluation results describe actual runs and limitations, and the final live/device checks are recorded without presenting fixture replay or gate coverage as proof of recognition accuracy.

## Final team acceptance run

1. **Agree on a WER/CER target first.** The current P1 result is a baseline, not an agreed pass target. Do not declare recognition successful just because captions appear.
2. On one laptop and one phone, use the same short, known script with Tagalog, English, and mixed Taglish phrases. Wait quietly for one second after starting capture.
3. For each device, check the microphone/SNR and segment boundaries, save P1’s raw output, and compare it with the human transcript.
4. Play the noisy recording and the noise-only recording. Confirm poor segments become visible gaps and noise-only audio does not produce invented captions.
5. Confirm the UI labels retained live text **unverified**, saves the session including vocabulary/summary, supports recovery and deletion, and opens the study sheet at End class.
6. Load the app and model while online, then turn on airplane mode and repeat a live phrase on the same device. Confirm the app, model, captions, and sheet work without external network requests.
7. Record the device, engine (WebGPU/WASM), latency, SNR, live gate/gap counts, WER/CER, no-speech hallucinations, and any failures in `eval/RESULTS.md`.

**Who owns the accuracy question?** P1 investigates wrong words; P2 verifies the audio that reaches the recognizer; P3 ensures the correct segments flow through the interface; P4 measures and reports the results.

---

# Updates on P4 — live segment contract, evaluation, and disclosures

**Date:** 2026-10-10
**Branch:** `p4-updates` (one commit, `d92ac27`, branched from `main` at `203ab53`)
**Pushed:** no — not published
**Tests:** `node --test` → 54 pass, 0 fail (was 39 before this work)

---

## 1. Starting point

`git pull` reported **already up to date**. Local `main` already contained
`origin/main` (including the P1/P3 live-word commit `4bd30c4`) and was 2
commits ahead of it, so there was nothing new to merge.

The task was the P4 section of the remaining-work notes above: validate the
P4 modules against P1's final `conf: null` live-word output, add a focused
cross-module check, score live runs, and update the evaluation and disclosure
documents.

## 2. The contract being validated

P1's unverified route, now settled:

| Decoder outcome | Segment shape |
| --- | --- |
| Successful decode with usable word timestamps | `words: [{ text, start, end, conf: null }, ...]`, no gap |
| Failed decode, timeout, repetition loop, rejected audio | whole-segment gap, no words |
| Decoder confidence | **none** — `supportsWordConfidence` stays `false` |

So accepted captions are described as **unverified**, and gate-pass coverage is
audio-gate pass time — not model confidence and not word accuracy.

## 3. Work done

### 3.1 Cross-module contract check — `eval/live-words.test.mjs` (new)

Six checks. The important one drives a **real segment out of P1's engine**
(stub worker, so it fails if P1's output shape drifts) rather than hand-writing
a fixture segment:

- a live decode arrives as timed `conf: null` words and survives `gateSegment`
- low-SNR live audio becomes an `snr_below_threshold` gap with no invented
  words and no `alternatives`
- repetition, too-short, and low-confidence reasons stay visible gaps with
  honest wording (never "error")
- no displayed word overlaps a gap; all word times stay inside their segment;
  gaps come back sorted
- a gap guess never becomes a displayed word, a vocabulary term, or a summary
  line
- Taglish, vocabulary, summary, and coverage all read the new shape; the
  summary still says *unverified* and *audio-quality checks*, and never prints
  a percentage labelled as confidence or accuracy

### 3.2 Finding: fixture files carry invented `conf` values

`lessons/fixtures/clean.fixture.json`, `noisy`, and `taglish` all contain
authored `conf` numbers — 111 of them in the clean take, 69 in noisy. They are
not decoder output.

Fixture mode is currently **safe**: `web/index.html` routes both fixture and
live modes through the same `gateSegment` call, which overwrites every `conf`
with `null`. But the safety depends entirely on that call happening. Any path
that renders a segment without the gate — a new preview, a debug view, a
recovery screen — would leak fake confidence numbers and skip the unverified
badge in the caption meta line.

Mitigated by pinning it: the check now runs all three real fixture files
through the gate and asserts no authored score survives, and it also records
the expected gate behaviour at the measured 16 dB default (clean and taglish
keep their 111 words; noisy becomes all `snr_below_threshold` gaps; the same
audio at a relaxed threshold brings the words back, still unverified).

### 3.3 Run scorer — `eval/score-run.mjs` (new)

`eval/wer.mjs` only compares two files. The acceptance run needs a whole gated
live run scored, so `score-run.mjs` takes one run manifest and reports:

- **`rawAsr` / `rawAsrBySlice`** — WER and CER of the recognizer's raw text
  against P2's human-labeled spans, overall and per human-labeled TL / EN / MIX
  slice, aligned by time overlap so a gated-out span counts as a deletion
  rather than being silently dropped
- **`displayed`** — what the student actually saw: accepted coverage, gap
  rate, gap seconds by reason, and whether every shown word was unverified
- **`noSpeech`** — noise-only segments and how many produced invented words
- **`latencyMs`** — caption and decode time, mean / median / p95 / max
- **`diagnostics`** — each observed failure routed to the lane that can fix
  it: P1 wrong raw words, P2 capture or gating, P4 evaluation or labeling

Rules the tool enforces rather than trusting the operator:

- refuses a run whose runtime or engine is `fixture` — fixture replay is a UI
  check, never accuracy
- reports a slice with no human reference as `no human reference`, not `0%`
- treats a target with no measurement as `not measured`, never as a pass
- treats "no noise-only audio in this run" as no hallucination evidence at all
- never consults `conf`

With `--targets`, it exits non-zero if any agreed target is not met, which is
the acceptance run's decision step.

Schema and a fill-in template: `eval/runs/run-manifest.template.json`. Tests:
`eval/score-run.test.mjs` (7 checks covering the rules above, not accuracy).

### 3.4 One small change to a P3-owned file

`web/captions.js` now exports `mergeWordsAndGaps`; `CaptionRenderer.mergedItems`
delegates to it. Same behavior, but the word/gap interleaving — the ordering
that decides whether a gap renders as text or as a gap — is now checkable
without a DOM. This is the only P4 edit to a P3 file, and it is additive.

### 3.5 Documentation

- **`eval/RESULTS.md`** — rewritten. Opens by stating plainly that no
  live-device results exist. The one committed measurement is now labeled as
  what it actually is: a recorded-audio baseline, decoded offline span by span
  on one laptop, over a 113-word human reference. All four P1 conditions are
  tabulated, including the forced-Tagalog row at 201.8% WER, which is the
  repetition-loop artifact and is more informative than a single headline
  number. Added the run-scoring workflow, the tool's refusal rules, the empty
  live results table, and a limitations section covering sample size, per-slice
  reference size, and the coverage-versus-accuracy distinction.
- **`README.md`** — build status no longer claims P1/P2 are unmerged. States
  the settled contract, what is *not* verified (live mic path, offline reload,
  phone performance, UI recovery and deletion), the evaluation commands,
  including `score-run.mjs`, and notes the `mergeWordsAndGaps` ownership.
- **`DISCLOSURES.md`** — model and framework rows now carry P1's committed
  evidence (`Xenova/whisper-tiny`, `@huggingface/transformers` 4.3.1, WebGPU
  in the recorded run) with device-specific items still marked to confirm.
  Decoder confidence stays **unavailable**. Added the fixture-authored-`conf`
  trap and the baseline's scope to the known limits.

## 4. What is still not done, and who owns it

| Item | Owner | Why it is blocked |
| --- | --- | --- |
| Live WER/CER on phone and laptop | P1 → P4 | Needs P1's raw live outputs and decode times as run manifests |
| TL / EN / MIX slice rates | P2 → P4 | Needs `lesson-noisy.labels.txt` verified against what was actually spoken |
| Noisy take at the 16 dB default on device | P2 | Threshold is measured on recorded audio, not on the demo hardware |
| Fixture-mode rendering check in a browser | P4 (me) | Chrome is not installed on this machine; the fixture path was verified statically and through the gate, but captions and the study sheet were not visually inspected |
| Live captions, sheet, stored session agreement | P3 → P4 | P3's wiring is not in this checkout |
| Airplane-mode reload, delete-and-confirm-gone | P3 → P4 | Needs the deployed build on both devices |
| Agreed targets in `eval/targets.json` | Team | Must be set before the run, or there is nothing to judge against |

## 5. Notes for the team

- The scorer expects P1's handover in a specific shape: device, runtime,
  model, package, settings, gate thresholds, `goldPath`, and per-segment
  `snrDb` / `latencyMs` / `decodeMs` / `speechPresent` / `raw.text` / `words` /
  `gaps`. The template spells this out field by field. P2's gate log supplies
  the segment half.
- Coverage and WER must never appear in the same column of the write-up. That
  is the main way this prototype could mislead a reader, and `score-run.mjs`
  keeps them in separate blocks for exactly that reason.
- `eval/live-words.test.mjs` is a contract test, not a measurement. It fails if
  P1, P2, or P3 change the segment shape, which is the point — but its name and
  its header comment both say it must never be quoted as accuracy.
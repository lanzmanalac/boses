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

The task was the P4 section of `REMAINING-WORK-AND-ACCEPTANCE.md`: validate the
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
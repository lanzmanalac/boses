# Evaluation results

**No live-device results are recorded yet.** Nothing in this file may be quoted
as recognition accuracy until the acceptance run below has been performed on
the demo phone and laptop with the shipped model and settings.

What *is* committed is a recorded-audio baseline, and it is a different claim:
P1 decoded `lessons/sample/lesson-clean.wav` offline, span by span, against
P2's human transcript. That exercises the model and the scoring tool. It is
not the browser's live microphone path, and it does not test capture, gating,
or the captions.

| Baseline (recorded audio, not live) | Model | Runtime | Gold words | WER | CER |
| --- | --- | --- | ---: | ---: | ---: |
| Clean lesson, forced Tagalog language | Xenova/whisper-tiny | WebGPU | 113 | 201.8% | 168.2% |
| Clean lesson, language unset | Xenova/whisper-tiny | WebGPU | 113 | 94.7% | 55.5% |
| Clean lesson, English language | Xenova/whisper-tiny | WebGPU | 113 | 94.7% | 55.5% |
| **Clean lesson, hotword prompt, Tagalog** | Xenova/whisper-tiny | WebGPU | 113 | **65.5%** | **23.8%** |

Source: `eval/runs/p1-lesson-clean/meta.json`, transformers.js 4.3.1, decoded
by the team on a Mac (paths in that file are P1's original absolute paths).
Force-decoding a Tagalog lesson as Tagalog produces a repetition loop, which
is why that row is above 100% WER — the insertions are the model repeating.
Read the four rows together: the language and hotword choice changes the error
rate more than any other setting measured so far, and none of these rows is a
reason to have chosen it.

## Method

- Record the audio source, date, device, model, engine (`WebGPU` or `WASM`),
  lesson language mix, sample size, and P2's measured SNR for each run.
- Compare the **raw ASR text** against the human transcript with
  `node eval/wer.mjs <gold.txt> <raw-asr.txt> [label]`. Preserve Taglish; the
  tool normalizes Unicode, case, and punctuation but does not translate.
- For SNR calibration, prepare an array of human-labeled utterances containing
  `snrDb` (number), `speechPresent` (boolean), `goldText` (human reference),
  and `rawText` (model output). Run `node eval/snr-sweep.mjs <cases.json>`.
  Review accepted errors, rejected speech, and no-speech hallucinations at
  each candidate threshold; do not select a threshold from fixtures.
- Run clean and noisy takes separately. If the performances differ, each needs
  its own human transcript.
- Report TL, EN, and MIX subsets only after a human has labeled the reference
  spans. Do not infer those labels from the recognizer's output.
- Report how many segments were shown, gap-marked, and flagged, plus the
  measured SNR threshold and minimum-duration setting.
- Decoder confidence calibration is **not applicable**: the engine exposes text
  and timestamps only. Report gate-pass coverage and hallucinations on
  no-speech audio instead, and describe accepted captions as unverified.
- Verify network-disabled behavior and the complete path on one phone and one
  laptop. Note the model engine and caption latency on each.

## Scoring a live run

`eval/score-run.mjs` scores one live run end to end and is the tool the
acceptance record should be generated from.

```sh
cp eval/runs/run-manifest.template.json eval/runs/<condition>-<device>.json
# fill in device, runtime, model, package, settings, gate, goldPath, segments
node eval/score-run.mjs eval/runs/<condition>-<device>.json \
  --targets eval/targets.json
```

The report keeps the two claims apart on purpose:

- `rawAsr` and `rawAsrBySlice` — WER/CER of the recognizer's raw text against
  P2's human spans, overall and per human-labeled TL/EN/MIX slice. A slice
  with no human reference is reported as `no human reference`, not as a number.
- `displayed` — what the student actually saw: accepted coverage, gap rate,
  and gap seconds by reason. Coverage is audio-gate pass time. It is not model
  confidence and not word accuracy, and `displayed.coverageRatio` must never be
  reported next to WER as if the two were comparable.
- `noSpeech` — segments where no one spoke, and how many of them produced
  invented words. A run with no noise-only audio has not measured this.
- `latencyMs` — caption latency and decode time, median and p95.
- `diagnostics` — each observed failure routed to the lane that can fix it
  (P1 wrong raw words, P2 capture or gating, P3 display/storage/offline, P4
  evaluation or labeling), so the fix-and-repeat step has an owner.

The tool refuses to score a run whose runtime or engine is `fixture`. Fixture
replay checks the UI path; it is never recognition accuracy. With
`--targets`, the process exits non-zero if any agreed target is not met, and a
target with no measurement reports `not measured` rather than a pass.

`node eval/wer.mjs` remains the right tool for a single gold/hypothesis file
pair; `score-run.mjs` is for a whole gated run with per-segment data.

## Results to fill from the acceptance run

Agreed targets must be recorded in `eval/targets.json` **before** the run.

| Condition | Device / engine | Gold words | WER | CER | SNR | Gap rate | No-speech hallucinations | Latency p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Clean Taglish | Pending | — | — | — | — | — | — | — |
| Noisy Taglish | Pending | — | — | — | — | — | — | — |
| Noise-only | Pending | 0 (expected) | n/a | n/a | — | — | Pending | — |
| TL subset | Pending human labels | — | — | — | — | — | — | — |
| EN subset | Pending human labels | — | — | — | — | — | — | — |
| MIX subset | Pending human labels | — | — | — | — | — | — | — |

Accepted coverage ratio (audio-gate pass time), reported separately from the
table above: pending.

## Limitations to state in the write-up

- The 65.5% WER / 23.8% CER baseline is from recorded audio decoded offline,
  on one laptop, with a tiny model. It is not the live microphone path.
- The gold reference covers one scripted lesson (13 human-labeled spans). That
  is a small sample; report the reference word count with every rate.
- The Taglish subsets are tiny. Do not report a per-slice rate whose reference
  has fewer than a few dozen words without saying so.
- Gate-pass coverage and word accuracy are different quantities. Reporting one
  as the other is the main way this prototype could mislead a reader.
- The prototype has not been evaluated with students, and the phone and laptop
  numbers do not exist yet.
- The fixture files in `lessons/fixtures/` carry authored `conf` values. They
  are not decoder output; `gateSegment` strips them to `null` and the captions
  then show the unverified badge. Any path that renders a fixture segment
  without going through the gate would leak those numbers, which is why the
  contract check exercises the real fixture files.

Document any failures and missing measurements alongside the final numbers.
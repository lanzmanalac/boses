# Boses disclosures — submission draft

Fill every pending field from the **shipped build** before submission. This
draft does not claim a model, deployment, or recording that has not been
verified in this checkout.

## Models and frameworks

| Item | Current evidence | Final value to confirm |
| --- | --- | --- |
| ASR model, size, quantization, and source | `Xenova/whisper-tiny`, recorded in `eval/runs/p1-lesson-clean/meta.json` from P1's offline decode | P1 to confirm the model shipped in the browser build, its size and license, and the quantization |
| Browser inference framework and version | `package.json` pins `@huggingface/transformers` 4.3.1; the same version appears in P1's run metadata | P1 to confirm the version actually loaded in the shipped build |
| WebGPU / WASM behavior | P1's recorded run used `webgpu`; the engine falls back to WASM, and the load path reports which one won | Record which path worked on the demo phone and on the laptop. A phone may well run WASM only |
| Decoder word confidence | The engine returns text and timestamps only; `supportsWordConfidence` is `false` | State **unavailable**. Accepted captions are described as unverified |
| Optional local LLM | Not implemented anywhere in the code | State absent |
| Cloud services | Intended static hosting only | Record chosen host and verify network requests after first load |

## What the current P4 code does

- `web/fixture.js` replays authored JSON lessons. Fixture scores, if present,
  are not measured decoder confidence and are not used to claim accuracy.
- `web/confidence.js` gates segments using P2's measured SNR and duration
  thresholds plus P2's repetition signal. Passing text keeps `conf: null` and
  must be labelled **unverified**. Failed checks become visible gaps.
- `web/taglish.js` annotates known TL/EN/MIX words without translating them.
- `web/vocab.js` counts displayed terms and shows checked TL/EN pairs only when
  both forms occur in the transcript.
- `web/summary.js` creates a deterministic, transcript-grounded overview.
  It does not call an LLM or generate new lesson facts.
- `web/store.js` stores sessions in browser IndexedDB.
- `eval/score-run.mjs` scores one live run: raw WER/CER against the human
  reference, per human-labeled TL/EN/MIX slice, plus displayed coverage, gap
  rate, no-speech hallucinations, latency, and per-lane failure attribution.
  It refuses a `fixture` run and will not report an unlabeled slice as a
  number. `eval/RESULTS.md` must be generated from this tool.

## Data and privacy

The intended architecture processes audio and transcript data on the device.
No P4 module uploads either to a server. The complete app's network behavior
cannot be certified until P1's model loader, P2's capture path, P3's service
worker, and the deployment host are tested together. Record any one-time model
download and all other network requests observed in that test.

P2 must confirm the provenance and consent status of every demo recording.
The demo plan calls for team-recorded simulated lessons and no real student
audio; do not assert that as a completed fact until the assets are checked.
Session text is per-device; there is no account or cross-device sync. Deletion
removes the local IndexedDB records once P3 connects the UI action.

## Existing work, assets, and development tools

| Item | Disclosure to complete |
| --- | --- |
| Existing code and assets | Identify each external source and its license after the final asset audit. Existing diagrams, icons, and code in this repository need team provenance confirmation. |
| AI-assisted development | Codex assisted with P4 fixture, confidence, Taglish, vocabulary, summary, storage, evaluation, and documentation code. Each teammate should add any other AI tools they used. |
| Audio and transcripts | P2 to list recording dates, speakers, locations, and who hand-transcribed the gold references. P2's `lessons/` carries the recordings and the 13-span clean gold reference used by the committed baseline |
| Evaluation numbers | The only committed numbers are a recorded-audio baseline in `eval/RESULTS.md` (not the live path). Live phone and laptop numbers are pending. Fixtures are excluded |

## Known limits to state plainly

- An SNR-passing caption can still be wrong. Audio-quality gate coverage is
  not decoder confidence or word accuracy.
- Taglish labels use a small, inspectable lexicon. Unrecognized terms remain
  unlabeled; the language pass does not repair ASR errors.
- Vocabulary ranking is frequency-based, not semantic understanding.
- The deterministic overview quotes and counts captured material; it is not a
  substitute for a human-authored lesson summary or an interpreter.
- Offline operation, phone performance, and deletion must be verified on the
  final integrated build and reported as tested, not assumed.
- The committed 65.5% WER / 23.8% CER baseline is a tiny model decoding one
  scripted lesson offline on one laptop, over a 113-word human reference. It is
  not the live microphone path and must not be presented as a product
  accuracy figure.

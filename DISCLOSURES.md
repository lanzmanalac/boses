# Boses disclosures — submission draft

Fill every pending field from the **shipped build** before submission. This
draft does not claim a model, deployment, or recording that has not been
verified in this checkout.

## Models and frameworks

| Item | Current evidence | Final value to confirm |
| --- | --- | --- |
| ASR model, size, quantization, and source | P1 module not merged here | P1 to enter exact model identifier, size, license, and quantization |
| Browser inference framework and version | Architecture proposes `transformers.js` | P1 to confirm actual package and version |
| WebGPU / WASM behavior | Design requires both paths | P1/P3 to record which path worked on phone and laptop |
| Decoder word confidence | P1 reports text and timestamps only | State **unavailable** unless a later measured build changes this |
| Optional local LLM | Not implemented in the P4 code | State absent if cut; otherwise record exact model and version |
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
- `web/store.js` stores sessions in browser IndexedDB. The complete UI
  recovery and one-tap delete path remains to be wired and tested by P3.

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
| Audio and transcripts | P2 to list recording dates, speakers, locations, and who hand-transcribed the gold references. |
| Evaluation numbers | Enter only measurements from actual recorded audio and the final model in `eval/RESULTS.md`; fixtures are excluded. |

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

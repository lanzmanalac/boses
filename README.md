# Boses

Boses is a phone-and-laptop classroom captioning prototype for Taglish lessons.
It aims to keep audio and transcripts on the student's device, mark uncertain
spans visibly, and produce an end-of-class study sheet. The primary user is a
deaf or hard-of-hearing student following a lesson as it happens.

## Why local AI

Classroom internet can fail, a cloud transcription service adds ongoing cost,
and lesson audio can contain sensitive student speech. Boses is designed to do
capture, recognition, gap marking, and post-class processing on the device.
The app shell and model must be downloaded once before an offline session.
The complete no-network claim still needs a device-level test of the finished
P1–P4 integration; see [evaluation status](eval/RESULTS.md).

## Current build status

The P3 browser shell, captions, study-sheet renderer, and service worker are in
the repo. P4's fixture adapter, audio-quality gate, Taglish annotations,
vocabulary, deterministic summary, local session store, and offline text
metrics are implemented on the P4 branch. P1's ASR engine and P2's lesson
fixtures, gold transcript, and measured thresholds have not yet been merged
into this checkout. The real lesson flow and airplane-mode behavior are **not
yet verified**.

P1 reports text and timestamps without decoder word-confidence scores. The
P4 fallback labels accepted text **unverified** and replaces segments that
fail measured audio-quality checks with gaps. Gate-pass coverage is not a
probability that displayed words are correct. P3's UI copy and integration
still need to reflect this decision before the demo.

## Run locally

These browser modules need an HTTP origin; do not double-click `index.html`.
From the repository root, run:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/web/index.html?fixture=1`. Once P2's JSON files
exist, `?fixture=noisy` and `?fixture=taglish` select those takes. Fixture mode
replays authored test data and does not measure ASR accuracy. A real-model run
requires P1's engine and P3's final wiring.

For an offline check, first load the deployed app and all needed model/fixture
assets online on the **same device and origin**, then disconnect networking and
reload. The current service worker needs a host configuration that lets it
serve `lessons/fixtures/` outside its default `/web/` scope; do not claim the
cold offline fixture path works until this is tested on the chosen host.

## Data flow and module owners

| Owner | Responsibility | Files |
| --- | --- | --- |
| P1 | In-browser speech recognition and model fallback | `web/asr.js`, `web/hotwords.js`, `web/hw-eval.js` |
| P2 | Audio recordings, capture, noise measurement, fixtures, gold transcript | `web/capture.js`, `web/noise.js`, `lessons/` |
| P3 | Caption UI, study sheet, service worker, integration | `web/index.html`, `web/captions.js`, `web/sheet.js`, `web/sw.js`, `web/styles.css` |
| P4 | Fixture selection, audio-quality gate, Taglish annotations, vocabulary, summary, storage, evaluation, disclosures | `web/fixture.js`, `web/engine-select.js`, `web/confidence.js`, `web/taglish.js`, `web/vocab.js`, `web/summary.js`, `web/store.js`, `eval/`, this README, `DISCLOSURES.md` |

Shared browser data shapes are in `contracts.ts`. Browser modules are plain
JavaScript; TypeScript types appear only in JSDoc comments.

### Integration handoff for P3

Before rendering or saving a real ASR segment, call `gateSegment(raw, {
snrThresholdDb, minDurationSec, repetitionDetected,
supportsWordConfidence: engine.supportsWordConfidence })` from
`web/confidence.js`. P2 supplies the measured thresholds and repetition
signal. Use the returned segment in captions, the in-memory session, and
`store.appendSegment`; never keep the ungated text as the displayed record.
At class start, call `store.beginSession(session)`. At class end, fill
`session.vocab` with `store.extractVocab(session)`, fill
`session.summaryLines` with `store.buildSummary(session)`, then call
`store.finalizeSession(session)`. Connect `store.getSession` for recovery and
`store.deleteAllSessions` to the one-tap delete control.

The UI must call retained text **unverified**. The printed coverage percentage
is the share of marked transcript time that passed audio-quality checks, not
model confidence or word accuracy. P3 should update `web/sheet.js` and
`web/index.html` copy accordingly, fix the missing `id="stage"` used by the
end-class handler, and verify the service-worker scope and cache version once
P2's fixture files are added. These are P3-owned files; P4 does not edit them.

## Post-class output and privacy

The deterministic overview quotes captured words and lists terms, gaps, and
student flags. It does not generate new lesson facts. The study sheet should
show the full transcript so each excerpt can be checked. Vocabulary comes
only from displayed words; uncertain gap alternatives are excluded.

P4's `web/store.js` saves text segments incrementally in device-local
IndexedDB and exposes retrieval and permanent-deletion functions. P3 still
needs to connect session start, finalization, recovery, and the delete control
in the UI. Sessions do not sync between devices. The final privacy and network
behavior must be checked on the deployed build before submission.

## Evaluation

Run the local P4 checks with:

```sh
node --test
```

When P2's human transcript and P1's raw output arrive, run:

```sh
node eval/wer.mjs lessons/gold/lesson-clean.transcript.txt path/to/raw-asr.txt clean-taglish
```

The command reports word and character error rates. It ignores case and
punctuation, preserves the words and code-switching, and reports an undefined
rate when the reference contains no words. Record actual device, SNR, and
language-subset measurements in [eval/RESULTS.md](eval/RESULTS.md).
The same evaluation folder contains `eval/snr-sweep.mjs` for reviewing
candidate noise thresholds once human-labeled clean/noisy cases exist.

## Limitations and disclosures

Audio-quality gates can reject poor input, but passing them does not prove the
caption text is accurate. Word-level confidence calibration is unavailable
without decoder scores. Fixture replay proves the UI path, not live model
accuracy. The prototype has not been evaluated with real students. See
[DISCLOSURES.md](DISCLOSURES.md) for the remaining model, data, and asset
details that must be confirmed before submission.

## Submission text draft

**Project name:** Boses

**One-line description:** On-device Taglish classroom captions that show
uncertain spans and turn a lesson into a study sheet for a deaf or
hard-of-hearing student.

**Why local AI:** A lesson should remain accessible when a school's connection
fails. Processing speech on the student's phone or school laptop also avoids
per-minute cloud transcription costs and keeps classroom speech on the device.
After the initial app and model download, the intended lesson path is offline;
the team will report the actual network-disabled test of the final build.

**Evidence to insert before submitting:** public repository URL, member names,
demo and backup-video links, tested phone and laptop models, actual ASR model
and runtime, measured clean/noisy results, and the completed disclosures.

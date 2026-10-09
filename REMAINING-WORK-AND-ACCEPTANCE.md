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

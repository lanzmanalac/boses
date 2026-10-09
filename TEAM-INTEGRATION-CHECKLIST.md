# Boses: team tasks and final transcription test

## Current status

- P1’s recognizer, P2’s capture and fixtures, and P4’s modules are on `main`. P2’s fixture timing fix is already merged.
- Live audio goes from **P2 capture → P1 recognizer → P3 display**.
- P4’s `gateSegment()` and `tagSegment()` are **not called in the current live path**. Wiring them into the UI is P3’s integration task.
- P4’s gate can mark a segment as a gap or label retained words “unverified.” It cannot correct words the recognizer misheard.
- The current recognizer uses Whisper Tiny and forces Tagalog. P1 should check that configuration against English and Taglish speech.
- The current UI’s end-class handler looks for an element with `id="stage"`, but the `<main>` element does not have that ID. P3 needs to fix that for the study sheet to appear.
- The fetch binding fix applied to `web/fixture.js` is still local and uncommitted. It fixes fixture startup, not live transcription accuracy.

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

- Publish the local `web/fixture.js` fetch-binding fix on a follow-up branch.
- Help P3 wire the gate and verify the output stays labeled “unverified”; P4 owns the gate code, while P3 owns the UI integration.
- Compare P1’s raw output against P2’s human transcript with `eval/wer.mjs`.
- Fill in `eval/RESULTS.md` with real measurements. Update the README’s status, which may still describe P1/P2 work as not merged.

**Check:**

- Run the fixture, confidence, and evaluation checks.
- Make sure low-SNR/short/repetition cases become gaps and that accepted text is not represented as model confidence.
- Keep fixture replay results separate from real ASR accuracy results.

**Done when:** evaluation results describe actual runs and limitations, without presenting fixture replay as proof of recognition accuracy.

## Final team acceptance run

1. **Agree on a WER/CER target first.** The current results document has no numeric accuracy target, so don’t declare recognition successful based only on captions appearing.
2. On one laptop and one phone, use the same short, known script with Tagalog, English, and mixed Taglish phrases. Wait quietly for one second after starting capture.
3. For each device, check the microphone/SNR and segment boundaries, save P1’s raw output, and compare it with the human transcript.
4. Play the noisy recording and the noise-only recording. Confirm poor segments become visible gaps and noise-only audio does not produce invented captions.
5. Confirm the UI labels retained live text **unverified**, saves the session, and opens the study sheet at End class.
6. Load the app and model while online, then turn on airplane mode and repeat a live phrase on the same device. Confirm the app, model, captions, and sheet work without external network requests.
7. Record the device, engine (WebGPU/WASM), latency, SNR, WER/CER, and any failures in `eval/RESULTS.md`.

**Who owns the accuracy question?** P1 investigates wrong words; P2 verifies the audio that reaches the recognizer; P3 ensures the correct segments flow through the interface; P4 measures and reports the results.

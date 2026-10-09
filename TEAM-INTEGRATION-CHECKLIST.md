# Boses: team tasks and final transcription test

> Historical integration snapshot from before `main` reached `5779297`.
> P1's timed unverified words and P3's threshold, storage, recovery, and
> deletion wiring have since merged. See
> [REMAINING-WORK-AND-ACCEPTANCE.md](REMAINING-WORK-AND-ACCEPTANCE.md) for the
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

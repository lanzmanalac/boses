# Evaluation results

No real ASR results are recorded yet. P2's human transcript and P1's raw ASR
output are required before reporting WER or CER. Fixture replay is a UI test,
not evidence of recognition accuracy.

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
- Decoder confidence calibration is **not applicable** to the current P1
  text-and-timestamps engine; it exposes no word confidence. Report gate-pass
  coverage and hallucinations on no-speech audio instead.
- Verify network-disabled behavior and the complete path on one phone and one
  laptop. Note the model engine and caption latency on each.

## Results to fill from actual runs

| Condition | Device / engine | Gold words | WER | CER | SNR | Gap rate | No-speech hallucinations | Latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Clean Taglish | Pending | — | — | — | — | — | — | — |
| Noisy Taglish | Pending | — | — | — | — | — | — | — |
| TL subset | Pending human labels | — | — | — | — | — | — | — |
| EN subset | Pending human labels | — | — | — | — | — | — | — |
| MIX subset | Pending human labels | — | — | — | — | — | — | — |

Document any failures and missing measurements alongside the final numbers.

# lessons/ — owned by P2

## Fixtures (for P1, P3, P4)

| File | Use it for |
| --- | --- |
| `fixtures/clean.fixture.json` | Caption UI, vocab, study sheet. 13 Taglish segments, 1 gap (a proper noun) |
| `fixtures/noisy.fixture.json` | Gap rendering, coverage, SNR gate. Same lesson, low SNR; every `GapReason.kind` appears at least twice |
| `fixtures/taglish.fixture.json` | Taglish pass. Clean segments + `_expected` (`lang` per segment, `wordLangs` per word: `TL` / `EN` / `NAME`) |
| `gold/lesson-clean.transcript.txt` | WER reference (one utterance per line) |
| `hotwords/lesson.txt` | Hotword list for P1 |
| `sweep/lesson-snr{20,10,5,0}.wav` | Clean take + recorded room noise at exact SNRs. **Same timing as the clean take**, so `gold/lesson-clean.labels.txt` is the reference for all four — WER vs SNR with no extra labelling |
| `gold/lesson-noisy.labels.txt` | Per-line timing for the separately recorded noisy take (same words as the clean labels) |

Each fixture file is:

```json
{ "fixture": "clean", "timing": "synthetic | recorded", "confFloor": 0.6, "segments": [ TranscriptSegment, ... ] }
```

`segments` follows `TranscriptSegment` in `contracts.ts` (build-plan version): times are seconds from session start, `engine` is `"fixture"`, and words below `confFloor` are already moved into `gaps` — words that remain carry their `conf`, so a stricter threshold can still be applied downstream. A `FixtureEngine` can return `segments[n]` on the n-th `transcribe()` call.

**Timing is synthetic until the real recording is labelled.** The shape will not change when real timings land — only the numbers.

## Regenerating

```bash
python3 lessons/fixtures/make_fixtures.py
```

Reads `gold/lesson-clean.labels.txt` (real recording) if it exists, otherwise `script/lesson.txt` with synthetic timing. Writes all three fixtures and the gold transcript. Stdlib only, deterministic.

## SNR sweep

```bash
python3 lessons/sweep/make_sweep.py
```

SNR = speech power inside the labelled lines vs. mean power of `sample/noise-only.wav` (looped, 50 ms crossfade at each seam). Re-measured from the output files: 20.00 / 10.00 / 5.00 / 0.00 dB, no clipping. With the confirmed 16 dB gate in `web/noise.js`, lines reaching the decoder are 13/13 at 20 dB, 8/13 at 10 dB, 0/13 at 5 and 0 dB — the rest become `snr_below_threshold` gaps. Per-segment detail: `GATE-REPORT.md` (`node lessons/tools/gate-report.mjs`). Model results: `docs/P2-audio-capture.md`.

## Recording (P2)

1. Read `script/lesson.txt` aloud as a teacher would (tags in brackets are not spoken).
2. **Clean take** → `sample/lesson-clean.wav`: quiet room, phone ~2 m away (desk distance).
3. **Noisy take** → `sample/lesson-noisy.wav`: same script, same distance, electric fan on + classroom chatter playing from another device.
4. **Noise-only** → `sample/noise-only.wav`: 30 s of the noisy room with nobody speaking (hallucination test).
5. Convert any recording to 16 kHz mono WAV: `ffmpeg -i in.m4a -ac 1 -ar 16000 sample/lesson-clean.wav`
6. In Audacity, label each utterance of the clean take (select, Cmd+B), typing exactly what was said with its tag, e.g. `[MIX] Ang output nito ay glucose at oxygen.` Export labels to `gold/lesson-clean.labels.txt`, then re-run `make_fixtures.py`.

All audio is team-recorded; no real students.

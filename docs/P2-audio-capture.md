# P2 — Audio, capture, and noise

**Owner:** P2 · **Files:** `web/capture.js`, `web/noise.js`, `web/noise.test.mjs`, `web/capture-check.html`, `lessons/**`

P2 makes sure Whisper only ever hears audio worth transcribing. Everything else — noise, coughs, a room too loud to trust — becomes a visible gap instead of an invented caption.

## Status

| Deliverable | Where | Status |
| --- | --- | --- |
| Clean, noisy, noise-only recordings | `lessons/sample/` | ✅ merged |
| Human-checked line timings + transcript (clean) | `lessons/gold/lesson-clean.*` | ✅ merged |
| Human-checked line timings and words (noisy take) | `lessons/gold/lesson-noisy.labels.txt` | ✅ verified against the audio by P2 |
| Fixtures (clean / noisy / taglish), real timings | `lessons/fixtures/` | ✅ merged |
| Hotword list | `lessons/hotwords/lesson.txt` | ✅ merged |
| Mic capture + noise gate | `web/capture.js`, `web/noise.js` | ✅ merged, wired by P3 |
| SNR sweep (20 / 10 / 5 / 0 dB) | `lessons/sweep/` | ✅ this branch |
| Confirmed thresholds + per-segment gate report | `lessons/GATE-REPORT.md` | ✅ this branch |
| Clipping check (first/last word of every line) | `lessons/GATE-REPORT.md` → Clipping check | ✅ |
| Live gate log for device tests | `MicCapture.exportLog()`, **Download log** on `capture-check.html` | ✅ |
| Live-mic test on laptop and phone | — | ⏳ pending |

## How it works

```
mic → 16 kHz mono → high-pass (100 Hz) → room noise-floor calibration (first 1 s)
    → utterance segmentation → gate → RawSegment
                                        ├─ passes → engine.transcribe(pcm, …)
                                        └─ fails  → gap segment, decoder never runs
```

Gate checks, cheapest first: **too short** (< 0.3 s → `too_short`), **too quiet vs. the room** (SNR < 16 dB → `snr_below_threshold`), **steady noise** (loud but unmodulated, e.g. a fan → `snr_below_threshold`). Hallucination-loop suppression (`repetition_suppressed`) runs after decoding, in P1's `asr.js`.

## Confirmed settings

| Setting | Value | Evidence |
| --- | --- | --- |
| SNR gate | **16 dB** | All 13 lines of both real takes pass. On the 10 dB sweep — where every model is ~100% wrong — 16 dB gates more of it than 12 dB did (8/13 lines pass with the final pause settings; 10/13 at 12 dB). Noise-only babble measures 7–11 dB. |
| Minimum duration | **0.3 s** | Coughs/taps in the noise-only clip and noisy take are 0.2–0.6 s; no real line is shorter. |
| Pause that ends an utterance | **0.5 s**, counted when the level is 5 dB above the room **or 22 dB below the speaker's own peak** | 0.35 s cut lines at commas (whisper-base WER 62% vs 46% at 0.5 s). In a quiet room breath and echo kept pauses above the room floor, so pieces ran to the 12 s limit (seen live too). The 22 dB rule gives a caption every ~4–6 s; cost: clean WER 57% vs 47% with 12 s pieces, noisy unchanged (58%). |
| Longest piece | **12 s**, cut at the quietest moment of the last 1.5 s | Avoids splitting a word when someone talks without pausing. |
| Audio kept around each piece | **0.2 s** before, **0.3 s** after; the rest of a pause is handed to the next piece | Clipping check: before this, soft sounds inside pauses were dropped (clean line 3 lost audio between pieces). Now real noisy take 13/13 lines arrive whole, clean 12/13 (the 13th: 0.14 s of breath-level sound at a label edge). |
| Room calibration | first **1 s** after Start | Floor = 15th percentile of the last 5 s afterwards, so it follows the room. |

All of these live in `DEFAULTS` in `web/noise.js`. Per-segment evidence for every recording: `lessons/GATE-REPORT.md` (`node lessons/tools/gate-report.mjs`).

## For teammates

- **P3 — wiring** (already done): `connectCapture(new MicCapture(), engine, { hotwords })` returns the `{ onSegment }` shape `streamSegments()` reads. Call `await mic.start()` first and `await mic.stop()` on End. `mic.signalQuality()` gives `{ capturing, snrDb }` for the HUD.
- **P4 — thresholds for `gateSegment()`**: import them instead of copying numbers, so there is one source of truth:
  `import { DEFAULTS } from './noise.js'` → `DEFAULTS.snrThresholdDb` (16), `DEFAULTS.minSpeechSec` (0.3). The repetition signal comes from P1's `asr.js`, not P2.
- **P1 — test data**: audio `lessons/sample/*.wav`, labels `lessons/gold/*.labels.txt` (`start<TAB>end<TAB>[TL|EN|MIX] text`), hotwords `lessons/hotwords/lesson.txt`.
- **Device test handoff (P1/P4):** on `capture-check.html`, tick *Show what Whisper hears*, **Start mic**, speak the script, **Stop mic**, then **Download log**. The JSON has the device, mic, settings, and per segment: time, SNR, room floor, `sent_to_asr`/gap reason, and what Whisper heard. A missing phrase marked as a gap is a capture problem (P2); marked `sent_to_asr` with wrong text, it is recognition (P1).
- **Testing the mic alone:** `python3 -m http.server 8000`, open `http://localhost:8000/web/capture-check.html`. Tests: `node --test web/*.test.mjs`.

## Measured results

All numbers from P2's real recordings. ASR numbers were run in Python (PyTorch, language forced to Tagalog) on the 13 human-labelled lines, punctuation and case ignored; hallucination-loop lines are excluded from WER and counted separately. **Browser (transformers.js) numbers still need to be measured by P1.**

**Gate — how much reaches the decoder** (confirmed settings; full detail in `lessons/GATE-REPORT.md`)

| Audio | Lines reaching decoder | Notes |
| --- | --- | --- |
| Clean take | 13 / 13 | 12 segments |
| Noisy take (fan + chatter) | 13 / 13 | 2 short blips gated |
| Noise only (no speech, 31 s) | **0** of 5 bursts | babble 7–11 dB → under the gate |
| Sweep 20 dB | 13 / 13 | |
| Sweep 10 dB | 8 / 13 | rest are gaps — ASR is ~100% wrong at this level |
| Sweep 5 dB / 0 dB | 0 / 13 | |

**End-to-end (gate segments → ASR, whole transcript, current settings)**

| Audio | whisper-tiny | whisper-base | whisper-small-fsc (Filipino) |
| --- | --- | --- | --- |
| Clean take | 81% / 29% CER | **48% / 15%** | 39% / 16%* |
| Real noisy take | 83% / 35% | **54% / 20%** | 46% / 16%* |

Handing pause audio to the next piece (no audio lost between pieces) took whisper-base on the clean take from 57% to 48%.
\* Filipino model measured with the earlier pause setting.

**Word error rate by model** (per human-labelled line)

| Audio | whisper-tiny | whisper-base | whisper-small-fsc (Filipino) |
| --- | --- | --- | --- |
| Clean take | 74% | 60% | 37% |
| Clean + hotwords | 65% | 56% | **29%** |
| Real noisy take | 96% | 73% | 58% |
| Real noisy + hotwords | 82% | 62% | **42%** |
| Sweep 20 dB | 89% | 65% | — |
| Sweep 10 dB | 110% | 101% | — |
| Sweep 5 dB / 0 dB | 115% / 105% | 111% / 105% | — |

Hallucination loops on the clean take: tiny 2, base 0 (1 with hotwords), fsc 0. On silence and on the noise-only clip, tiny and base output no words; fsc outputs short invented words — which the gate keeps from ever reaching it.

**What this means:** below ~10 dB every model is effectively wrong, so gating that audio into gaps is the honest output. whisper-base beats tiny everywhere; the Filipino fine-tune roughly halves the error but is ~6× larger.

## Robustness (stress-tested)

All in `node --test web/*.test.mjs` unless marked *measured*.

| Case | Result |
| --- | --- |
| Phone / Firefox mic at 48 or 44.1 kHz (JS resampling) | *measured:* same accuracy as native 16 kHz (whisper-base 48–49% vs 48%) |
| Firefox rejects a 16 kHz context for the mic | falls back to the device rate + resampler (was: mic failed to start) |
| Browser rejects the 16 kHz option | starts at device rate |
| iPhone Safari starts audio suspended | context resumed (was: silent capture) |
| Mic cannot start at all | `start()` rejects and the mic light turns off |
| Whisper throws on a piece | piece shown as a `low_confidence` gap, later pieces continue (was: silently dropped) |
| P1's new output (timed words, `conf: null`, `raw`) | passes through unchanged, order kept |
| Browser chunk size 128 / 441 / 2048 / 4096 / 7919 samples | identical segments |
| 30-minute lesson | far faster than real time; buffers bounded |
| Shouting (clipped audio) | 13/13 lines still captured |
| 60 s digital silence / steady hum | nothing reaches ASR |
| Teacher farther away, quiet room (−6 to −18 dB voice) | *measured:* 13/13 lines at every distance (SNR 21–37 dB) |
| Noise-only recording | 0 pieces reach ASR (browser and tests) |

## Open decisions

1. **Model** (P1's call): fsc on laptop + base as phone fallback, if the ONNX conversion fits the time left; otherwise base.

## Known limits

- One noise recording (fan + classroom chatter together). Steady noise and babble are not separated in the sweep.
- One speaker, one room, one lesson (~55 s). Numbers are indicative, not a benchmark.
- The live mic path is tested on a laptop page only; phone, Bluetooth mics, and a full lesson are untested.

## Data provenance (for DISCLOSURES.md)

| Item | Value |
| --- | --- |
| Recordings | `lesson-clean`, `lesson-noisy`, `noise-only` — recorded Oct 9, 2026 by P2 for this hackathon |
| Speaker | Cristina(team member P2; no students) |
| Location / device | Phone |
| Background in noisy take | electric fan + classroom-ambience audio played from another device — https://www.youtube.com/watch?v=FzL65bmD1Nw|
| Labels and transcripts | hand-checked by P2 in Audacity |
| Sweep files | generated from the recordings by `lessons/sweep/make_sweep.py` |
| Tools | Audacity, ffmpeg; Claude Code (AI-assisted code, analysis and docs) |

## Reproduce

```bash
python3 lessons/fixtures/make_fixtures.py   # fixtures + gold transcript from the clean labels
python3 lessons/sweep/make_sweep.py         # SNR sweep files
node --test web/*.test.mjs                  # gate + capture tests on the real recordings
```

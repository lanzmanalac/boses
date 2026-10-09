# P2 — Audio, capture, and noise

**Owner:** P2 · **Files:** `web/capture.js`, `web/noise.js`, `web/noise.test.mjs`, `web/capture-check.html`, `lessons/**`

P2 makes sure Whisper only ever hears audio worth transcribing. Everything else — noise, coughs, a room too loud to trust — becomes a visible gap instead of an invented caption.

## Status

| Deliverable | Where | Status |
| --- | --- | --- |
| Clean, noisy, noise-only recordings | `lessons/sample/` | ✅ merged |
| Human-checked line timings + transcript (clean) | `lessons/gold/lesson-clean.*` | ✅ merged |
| Human-checked line timings (noisy take) | `lessons/gold/lesson-noisy.labels.txt` | ✅ this branch |
| Fixtures (clean / noisy / taglish), real timings | `lessons/fixtures/` | ✅ merged |
| Hotword list | `lessons/hotwords/lesson.txt` | ✅ merged |
| Mic capture + noise gate | `web/capture.js`, `web/noise.js` | ✅ merged, wired by P3 |
| SNR sweep (20 / 10 / 5 / 0 dB) | `lessons/sweep/` | ✅ this branch |
| Confirmed thresholds + per-segment gate report | `lessons/GATE-REPORT.md` | ✅ this branch |
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
| SNR gate | **16 dB** | All 13 lines of both real takes pass. The 10 dB sweep — where every model is ~100% wrong — drops from 10/13 lines passing (at 12 dB) to 3/13. Noise-only babble measures 7–11 dB. |
| Minimum duration | **0.3 s** | Coughs/taps in the noise-only clip and noisy take are 0.2–0.6 s; no real line is shorter. |
| Pause that ends an utterance | **0.5 s** | 0.35 s cut lines at commas into fragments. 0.5 s keeps whole lines: whisper-base WER 62% → 46% (clean), 75% → 58% (noisy); Filipino model unchanged. Pieces average 6–7 s, max 12 s (force-cut). |
| Room calibration | first **1 s** after Start | Floor = 15th percentile of the last 5 s afterwards, so it follows the room. |

All of these live in `DEFAULTS` in `web/noise.js`. Per-segment evidence for every recording: `lessons/GATE-REPORT.md` (`node lessons/tools/gate-report.mjs`).

## For teammates

- **P3 — wiring** (already done): `connectCapture(new MicCapture(), engine, { hotwords })` returns the `{ onSegment }` shape `streamSegments()` reads. Call `await mic.start()` first and `await mic.stop()` on End. `mic.signalQuality()` gives `{ capturing, snrDb }` for the HUD.
- **P4 — thresholds for `gateSegment()`**: import them instead of copying numbers, so there is one source of truth:
  `import { DEFAULTS } from './noise.js'` → `DEFAULTS.snrThresholdDb` (16), `DEFAULTS.minSpeechSec` (0.3). The repetition signal comes from P1's `asr.js`, not P2.
- **P1 — test data**: audio `lessons/sample/*.wav`, labels `lessons/gold/*.labels.txt` (`start<TAB>end<TAB>[TL|EN|MIX] text`), hotwords `lessons/hotwords/lesson.txt`.
- **Testing the mic alone:** `python3 -m http.server 8000`, open `http://localhost:8000/web/capture-check.html`. Tests: `node --test web/*.test.mjs`.

## Measured results

All numbers from P2's real recordings. ASR numbers were run in Python (PyTorch, language forced to Tagalog) on the 13 human-labelled lines, punctuation and case ignored; hallucination-loop lines are excluded from WER and counted separately. **Browser (transformers.js) numbers still need to be measured by P1.**

**Gate — how much reaches the decoder** (confirmed settings)

| Audio | Lines reaching decoder | Notes |
| --- | --- | --- |
| Clean take | 13 / 13 | 7 segments |
| Noisy take (fan + chatter) | 13 / 13 | 2 short blips gated |
| Noise only (no speech, 31 s) | **0** of 5 bursts | babble 7–11 dB → under the gate |
| Sweep 20 dB | 13 / 13 | |
| Sweep 10 dB | 3 / 13 | rest are gaps — ASR is ~100% wrong here |
| Sweep 5 dB / 0 dB | 0 / 13 | |

**End-to-end (gate segments → ASR, whole transcript)**

| Audio | whisper-base | whisper-small-fsc (Filipino) |
| --- | --- | --- |
| Clean take | 46% WER / 14% CER | 39% / 16% |
| Real noisy take | 58% / 21% | 46% / 16% |

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
| Speaker | **TO CONFIRM** (team member P2; no students) |
| Location / device | **TO CONFIRM** |
| Background in noisy take | electric fan + classroom-ambience audio played from another device — **confirm source/licence** |
| Labels and transcripts | hand-checked by P2 in Audacity |
| Sweep files | generated from the recordings by `lessons/sweep/make_sweep.py` |
| Tools | Audacity, ffmpeg; Claude Code (AI-assisted code, analysis and docs) |

## Reproduce

```bash
python3 lessons/fixtures/make_fixtures.py   # fixtures + gold transcript from the clean labels
python3 lessons/sweep/make_sweep.py         # SNR sweep files
node --test web/*.test.mjs                  # gate + capture tests on the real recordings
```

"""Build the SNR sweep: the clean take mixed with the recorded room noise at exact levels.

    python3 lessons/sweep/make_sweep.py

Writes lessons/sweep/lesson-snr{20,10,5,0}.wav. Timing is identical to the clean
take, so lessons/gold/lesson-clean.labels.txt is the reference for every file —
WER vs SNR needs no extra labelling.

SNR is measured honestly: speech power inside the labelled utterances only (not
the pauses) against the mean power of the noise-only clip, which is looped to
length. Stdlib only, deterministic.
"""

import array
import math
import wave
from pathlib import Path

LESSONS = Path(__file__).resolve().parent.parent
CLEAN = LESSONS / "sample" / "lesson-clean.wav"
NOISE = LESSONS / "sample" / "noise-only.wav"
LABELS = LESSONS / "gold" / "lesson-clean.labels.txt"
OUT = LESSONS / "sweep"
TARGETS_DB = [20, 10, 5, 0]
RATE = 16000


def read(path):
    with wave.open(str(path)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return [s / 32768 for s in array.array("h", w.readframes(w.getnframes()))]


def write(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(array.array("h", (max(-32768, min(32767, round(s * 32767))) for s in samples)).tobytes())


def loop_to(noise, n, fade=int(0.05 * RATE)):
    """Repeat the noise clip to length n with a 50 ms crossfade at each seam (no click)."""
    out = list(noise)
    while len(out) < n:
        nxt = noise
        for i in range(fade):
            w = i / fade
            out[len(out) - fade + i] = out[len(out) - fade + i] * (1 - w) + nxt[i] * w
        out.extend(nxt[fade:])
    return out[:n]


def power(xs):
    return sum(x * x for x in xs) / max(1, len(xs))


def main():
    clean, noise = read(CLEAN), read(NOISE)
    noise = loop_to(noise, len(clean))

    speech = []
    for line in LABELS.read_text(encoding="utf-8").splitlines():
        start, end = (float(x) for x in line.split("\t")[:2])
        speech.extend(clean[int(start * RATE): int(end * RATE)])
    p_speech, p_noise = power(speech), power(noise)
    print(f"recorded clean take: speech {10 * math.log10(p_speech):.1f} dBFS, "
          f"room noise {10 * math.log10(p_noise):.1f} dBFS")

    for snr in TARGETS_DB:
        gain = math.sqrt(p_speech / (p_noise * 10 ** (snr / 10)))
        mix = [c + gain * n for c, n in zip(clean, noise)]
        peak = max(abs(m) for m in mix)
        if peak > 0.98:  # scale the whole mix down rather than clip; SNR is unchanged
            mix = [m * 0.98 / peak for m in mix]
        write(OUT / f"lesson-snr{snr}.wav", mix)
        print(f"lesson-snr{snr}.wav  target {snr} dB  noise gain {gain:.2f}" + ("  (normalised)" if peak > 0.98 else ""))


if __name__ == "__main__":
    main()

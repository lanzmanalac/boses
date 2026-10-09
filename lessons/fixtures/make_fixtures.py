"""Generate the three fixture files + gold transcript from one lesson source.

    python3 lessons/fixtures/make_fixtures.py

Source of truth, in priority order:
  1. lessons/gold/lesson-clean.labels.txt  - Audacity label export of the REAL clean
     recording: start<TAB>end<TAB>[TL|EN|MIX] what was actually said
  2. lessons/script/lesson.txt             - the reading script, with synthetic timing

Re-run after recording: real timings flow into every fixture, nobody else changes code.
Stdlib only, deterministic (fixed seed), so diffs stay readable.
"""

import json
import random
import re
from pathlib import Path

LESSONS = Path(__file__).resolve().parent.parent
LABELS = LESSONS / "gold" / "lesson-clean.labels.txt"
SCRIPT = LESSONS / "script" / "lesson.txt"
HOTWORDS = LESSONS / "hotwords" / "lesson.txt"
OUT = LESSONS / "fixtures"

CONF_FLOOR = 0.6          # words below this are already moved into gaps in every fixture
NOISY_SNR_GATE_DB = 6.0   # noisy segments below this never reach the decoder
WORDS_PER_SEC = 2.6       # synthetic timing only
PAUSE_SEC = 0.8

ENGLISH = set("""okay class good morning photosynthesis plants need three things sunlight water
and carbon dioxide chlorophyll chloroplast output glucose oxygen write that down in your
notebook remember any questions very""".split())
NAMES = {"jan", "ingenhousz", "maria"}
# Words the clean take should still be unsure about (proper noun ASR always struggles with).
CLEAN_UNSURE = {"ingenhousz": ["Ingenhousz", "Inhenhaus"]}


def bare(word):
    return re.sub(r"[^\w-]", "", word.lower())


def load_lines():
    if LABELS.exists():
        rows = []
        for line in LABELS.read_text(encoding="utf-8").splitlines():
            parts = line.split("\t")
            if len(parts) >= 3 and parts[2].strip():
                rows.append((float(parts[0]), float(parts[1]), parts[2].strip()))
        return rows, "recorded"
    rows, t = [], 0.5
    for line in SCRIPT.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        text = re.sub(r"^\[\w+\]\s*", "", line.strip())
        dur = round(len(text.split()) / WORDS_PER_SEC, 2)
        rows.append((round(t, 2), round(t + dur, 2), line.strip()))
        t += dur + PAUSE_SEC
    return rows, "synthetic"


def split_tag(text):
    m = re.match(r"\[(TL|EN|MIX)\]\s*(.*)", text, re.I)
    return (m.group(1).upper(), m.group(2)) if m else (None, text)


def time_words(tokens, start, end):
    weights = [len(bare(t)) + 2 for t in tokens]
    total, t, out = sum(weights), start, []
    for tok, w in zip(tokens, weights):
        d = (end - start) * w / total
        out.append((tok, round(t, 2), round(t + d, 2)))
        t += d
    return out


def to_segment(seg_id, start, end, timed, snr, latency):
    """Words below CONF_FLOOR become gaps (contracts.ts: low-confidence words are omitted)."""
    words, gaps, run = [], [], []

    def flush():
        if run:
            gaps.append({"start": run[0][1], "end": run[-1][2],
                         "reason": {"kind": "low_confidence",
                                    "alternatives": run[0][4] or [" ".join(r[0] for r in run)]}})
            run.clear()

    for tok, s, e, conf, alts in timed:
        if conf < CONF_FLOOR:
            run.append((tok, s, e, conf, alts))
        else:
            flush()
            words.append({"text": tok, "start": s, "end": e, "conf": conf})
    flush()
    return {"id": seg_id, "start": start, "end": end, "snrDb": snr,
            "words": words, "gaps": gaps, "engine": "fixture", "latencyMs": latency}


def gap_only(seg_id, start, end, snr, kind, alternatives=None):
    reason = {"kind": kind}
    if alternatives:
        reason["alternatives"] = alternatives
    return {"id": seg_id, "start": start, "end": end, "snrDb": snr, "words": [],
            "gaps": [{"start": start, "end": end, "reason": reason}],
            "engine": "fixture", "latencyMs": 0 if kind == "snr_below_threshold" else 400}


def main():
    rng = random.Random(7)
    rows, timing = load_lines()
    hot = {bare(w) for line in HOTWORDS.read_text(encoding="utf-8").splitlines() for w in line.split()}

    clean, noisy, taglish, gold = [], [], [], []
    noisy_gated = {3, 9} if len(rows) > 9 else {len(rows) // 2}

    for i, (start, end, raw) in enumerate(rows, 1):
        tag, text = split_tag(raw)
        gold.append(text)
        tokens = text.split()
        timed_clean = []
        for tok, s, e in time_words(tokens, start, end):
            b = bare(tok)
            if b in CLEAN_UNSURE:
                conf, alts = 0.48, CLEAN_UNSURE[b]
            elif b in hot:
                conf, alts = round(rng.uniform(0.74, 0.9), 2), None
            else:
                conf, alts = round(rng.uniform(0.86, 0.99), 2), None
            timed_clean.append((tok, s, e, conf, alts))

        seg = to_segment(f"clean-{i:03d}", start, end, timed_clean,
                         round(rng.uniform(20, 28), 1), rng.randint(700, 1500))
        clean.append(seg)

        langs = ["NAME" if bare(t) in NAMES else "EN" if bare(t) in ENGLISH else "TL" for t in tokens]
        taglish.append({**seg, "_expected": {"lang": tag, "wordLangs": langs}})

        # Noisy take: same content, lower SNR and confidence.
        if i in noisy_gated:
            noisy.append(gap_only(f"noisy-{i:03d}", start, end,
                                  round(rng.uniform(2, NOISY_SNR_GATE_DB - 0.5), 1), "snr_below_threshold"))
        else:
            timed_noisy = [(tok, s, e, round(max(0.05, c - rng.uniform(0.08, 0.38)), 2), a or [tok])
                           for tok, s, e, c, a in timed_clean]
            noisy.append(to_segment(f"noisy-{i:03d}", start, end, timed_noisy,
                                    round(rng.uniform(NOISY_SNR_GATE_DB, 12), 1), rng.randint(900, 2200)))

        # A cough / chair scrape in the pause after some utterances.
        if i in (2, 7) and i < len(rows):
            gap_start = round(end + 0.05, 2)
            noisy.append(gap_only(f"noisy-{i:03d}b", gap_start, round(gap_start + 0.2, 2), 9.0, "too_short"))

    # Whisper hallucination loops over fan noise after the lesson ends.
    t = rows[-1][1] + 1.0
    for n, alt in enumerate(["Salamat po. Salamat po. Salamat po.", "Thank you. Thank you. Thank you."], 1):
        noisy.append(gap_only(f"noisy-loop-{n}", round(t, 2), round(t + 2.5, 2), 7.5,
                              "repetition_suppressed", [alt]))
        t += 3.0

    meta = {"timing": timing, "confFloor": CONF_FLOOR,
            "note": "TranscriptSegment[] per contracts.ts; words below confFloor are already in gaps"}
    for name, segs in (("clean", clean), ("noisy", noisy), ("taglish", taglish)):
        payload = {"fixture": name, **meta, "segments": segs}
        if name == "noisy":
            payload["snrGateDb"] = NOISY_SNR_GATE_DB
        if name == "taglish":
            payload["note"] += "; _expected = test-only labels for the Taglish pass (not in contracts)"
        (OUT / f"{name}.fixture.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                                                  encoding="utf-8")
    (LESSONS / "gold" / "lesson-clean.transcript.txt").write_text("\n".join(gold) + "\n", encoding="utf-8")

    kinds = {}
    for seg in noisy:
        for g in seg["gaps"]:
            kinds[g["reason"]["kind"]] = kinds.get(g["reason"]["kind"], 0) + 1
    print(f"timing={timing}  segments={len(rows)}  noisy gap kinds={kinds}")


if __name__ == "__main__":
    main()

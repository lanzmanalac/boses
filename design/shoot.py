#!/usr/bin/env python3
"""Boses — render the UI and save screenshots.

There is no Chrome in this environment but there IS Firefox, which supports
headless screenshots. That matters more than it sounds: this project's whole
UI/UX lane was built without being able to SEE the result, and every serious
bug found late (a syntax error that killed every button, a top-level await
that hung the page, a callout clipped mid-sentence, gap hatching that made
the label unreadable) was invisible to static analysis and obvious in a
picture. Render it, then look at it.

Usage:
    python3 design/shoot.py                 # all viewports
    python3 design/shoot.py phone           # one viewport
    python3 design/shoot.py --gaps          # gap rendering proof (both themes)
    python3 design/shoot.py --states        # every UI state, incl. hidden ones

Viewports cover the two committed device classes: a propped phone (which is
usually landscape and short) and a school laptop.
"""
import os
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(os.path.expanduser("~/boses-shots"))


def free_port():
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port

# name -> (width, height)
VIEWPORTS = {
    "desktop":    (1280, 900),
    "laptop":     (1024, 700),
    "phone":      (380, 780),
    "landscape":  (844, 390),
}


def serve():
    port = free_port()
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port)],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2)
    return srv, port


def firefox():
    for name in ("firefox", "firefox-esr"):
        from shutil import which
        p = which(name)
        if p:
            return p
    return None


def shoot(ff, url, name, size):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    if path.exists():
        path.unlink()
    # NOTE: no `-profile` flag here. Firefox in this environment refuses to
    # screenshot against a throwaway profile. Cache is handled instead by
    # serving from a random port per run — a different origin means the
    # browser cannot reuse a stale stylesheet.
    subprocess.run(
        [ff, "--headless",
         f"--window-size={size[0]},{size[1]}",
         "--screenshot", str(path), url],
        capture_output=True, timeout=180,
    )
    return path if path.exists() else None


def gap_proof(ff, base):
    """Render gaps on their own, in colour and in greyscale.

    The greyscale shot is the acceptance test that matters: a student who
    photocopies the study sheet in black and white must still see every gap.
    Colour alone would fail it, which is why the gap carries a heavy left rule
    and a hatch rather than relying on a tint.
    """
    page = (ROOT / "web" / "_shoot_gaps.html")
    page.write_text(GAP_PAGE, encoding="utf-8")
    made = []
    for label, extra in (("gaps", ""), ("gaps_grey", ' filter:grayscale(1)')):
        page.write_text(GAP_PAGE.replace("<body>", f"<body style='{extra}'>"),
                        encoding="utf-8")
        p = shoot(ff, f"{base}/web/_shoot_gaps.html", label, (900, 620))
        if p:
            made.append(p)
    page.unlink(missing_ok=True)
    return made


GAP_PAGE = """<!doctype html><html data-theme="paper" data-contrast="standard">
<meta charset="utf-8"><link rel="stylesheet" href="./styles.css">
<body><div class="app" style="height:auto">
<header class="bar"><p class="brand"><span class="mark">[</span>Boses<span
  class="mark">]</span><small>gap rendering proof</small></p></header>
<div class=hud></div>
<main class=stage><div class=captions id=captions></div></main>
<footer class=foot><span class=status>fixtures</span></footer>
</div>
<script type="module">
import { CaptionRenderer } from './captions.js';
const r = new CaptionRenderer(document.getElementById('captions'));
const W = (t, s) => ({ text: t, start: s, end: s + 0.4, conf: null });
const seg = (id, start, words, gaps) => ({
  id, start, end: start + 2, snrDb: 18, latencyMs: 900,
  engine: 'whisper-wasm', words, gaps,
});
r.appendSegment(seg('s1', 0, [W('Ang', 0), W('chlorophyll', 0.4), W('ay', 0.8)], []));
r.appendSegment(seg('s2', 3, [W('absorbs', 3)], []));
r.appendSegment(seg('s3', 6, [], [{ start: 6, end: 8, reason: {
  kind: 'snr_below_threshold', alternatives: ['magnesium', 'magnesium sulfide'] } }]));
r.appendSegment(seg('s4', 9, [W('kapag', 9), W('nakatutok', 9.4)], []));
r.appendSegment(seg('s5', 12, [], [{ start: 12, end: 13.2, reason: { kind: 'low_confidence' } }]));
r.appendSegment(seg('s6', 14, [], [{ start: 14, end: 15.5, reason: { kind: 'repetition_suppressed' } }]));
// A segment the student pinned. Renders as a notched tab, not a highlight,
// so it stays findable when scrolling back through the transcript.
r.addFlag({ start: 9, end: 11, text: 'kapag nakatutok', reason: 'user_flagged' });
r.render();
</script>
"""


def states(ff, base):
    """Every UI state, so nothing hidden has to be hunted for.

    Uses the `?ui=` review parameter that index.html exposes. Without it, a
    design review misses the settings panel, the sessions list and the live
    caption view entirely — all of which are hidden until clicked, which is
    the whole point of a state-based layout.
    """
    made = []
    for view in ("panel", "sessions", "live"):
        p = shoot(ff, f"{base}/web/index.html?fixture=1&ui={view}",
                  f"state-{view}", VIEWPORTS["laptop"])
        if p:
            made.append(p)
        else:
            print(f"  state-{view}: FAILED")
    return made


def main():
    ff = firefox()
    if not ff:
        print("firefox not found — cannot screenshot")
        return 1

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    want_gaps = "--gaps" in sys.argv
    want_states = "--states" in sys.argv

    srv, port = serve()
    try:
        base = f"http://localhost:{port}"
        made = []
        if want_gaps:
            made += gap_proof(ff, base)
        elif want_states:
            made += states(ff, base)
        else:
            names = args or list(VIEWPORTS)
            for n in names:
                if n not in VIEWPORTS:
                    print(f"unknown viewport: {n}")
                    continue
                url = f"{base}/web/index.html?fixture=1"
                p = shoot(ff, url, n, VIEWPORTS[n])
                if p:
                    made.append(p)
                else:
                    print(f"  {n}: FAILED")
    finally:
        srv.terminate()

    for p in made:
        print(p)
    print(f"\n{len(made)} shot(s) -> {OUT}")
    return 0 if made else 1


if __name__ == "__main__":
    sys.exit(main())
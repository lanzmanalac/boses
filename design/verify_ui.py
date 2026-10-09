#!/usr/bin/env python3
"""Boses UI verification pass.

Checks the three failure modes that are silent in a browser and expensive to
find during a demo:

  1. Every $('id') lookup in index.html resolves to an element that exists.
     A miss means `$('foot')` is null and showState() throws on first call.
  2. The DOM contract tokens (design/SPEC.md §8) still exist.
  3. Every CSS custom property consumed via var(--x) is defined somewhere in
     styles.css. An undefined one makes the whole declaration invalid — e.g.
     an undefined var(--caption-fade-mask) silently kills the mask.
"""
import re
import pathlib
import sys
from pathlib import Path

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
html = (WEB / "index.html").read_text()
css = (WEB / "styles.css").read_text()
captions = (WEB / "captions.js").read_text()
sheet = (WEB / "sheet.js").read_text()

fails, warns = [], []

# ── 1. $('id') lookups ───────────────────────────────────────────────────────
declared = set(re.findall(r'\bid="([^"]+)"', html))
used = set(re.findall(r"\$\('([^']+)'\)", html))

missing = sorted(used - declared)
if missing:
    fails.append(f"$('id') with no matching element: {missing}")

unused = sorted(declared - used)
# Ids referenced from CSS or by other modules are legitimate.
unused = [u for u in unused if u not in {"stage", "captions", "hud", "sheet"}]

# ── 2. DOM contract ─────────────────────────────────────────────────────────
CONTRACT = ["stage", "captions", "hud", "sheet", "foot"]
for cid in CONTRACT:
    if cid not in declared:
        fails.append(f"DOM contract broken — #{cid} missing from index.html")

# captions.js builds [data-seg] and querySelector's it. If render() stops
# emitting data-seg, flagVisible() silently flags the wrong segment.
if 'data-seg=' not in captions:
    fails.append("captions.js no longer emits [data-seg] — flagging breaks silently")
if 'querySelector(`[data-seg=' not in captions:
    fails.append("captions.js no longer queries [data-seg] — flagVisible breaks")

# ── 3. CSS custom properties ────────────────────────────────────────────────
defined = set(re.findall(r'^\s*(--[a-z0-9-]+)\s*:', css, re.M))
consumed = set()
for f in (css, captions, sheet):
    consumed |= set(re.findall(r'var\(\s*(--[a-z0-9-]+)', f))

undefined = sorted(c for c in consumed - defined if c != '--type-scale')
if undefined:
    fails.append(f"var() with no definition in styles.css: {undefined}")

# --type-scale is written at runtime by Presentation.apply(), so it is expected
# to have no literal definition there.

# ── 4. Brace balance ────────────────────────────────────────────────────────
for name, text in (("styles.css", css), ("captions.js", captions),
                   ("index.html", html), ("sheet.js", sheet)):
    if text.count("{") != text.count("}"):
        fails.append(f"{name}: unbalanced braces "
                     f"({text.count('{')} open vs {text.count('}')} close)")

# ── 5. HTML tag balance ──────────────────────────────────────────────────────
# Comments are stripped FIRST: the DOM-contract comment legitimately contains
# a literal `[data-seg="<id>"]`, which a naive parser reads as an <id> tag.
body = re.sub(r"<script.*?</script>", "", html, flags=re.S)
body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
VOID = {"meta", "link", "br", "hr", "img", "input", "source", "area",
        "base", "col", "embed", "param", "track", "wbr"}
stack = []
for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>", body):
    closing, tag, _attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
    if tag in VOID or selfclose:
        continue
    if closing:
        if not stack:
            fails.append(f"HTML: </{tag}> with an empty stack")
        elif stack[-1] != tag:
            fails.append(f"HTML: expected </{stack[-1]}> but found </{tag}>")
        else:
            stack.pop()
    else:
        stack.append(tag)
if stack:
    fails.append(f"HTML: unclosed tags {stack}")

# ── 6. Craft guard: the sheet must not grow fake pages ──────────────────────
# .page::before/::after render two sheets stacked behind the real one. They
# must be suppressed in print or the printer emits three pages per sheet.
# NOTE: split on "@media print" and inspect the LAST block, because the craft
# layer is appended after the original print block and would otherwise win.
print_blocks = css.split("@media print")
tail = print_blocks[-1]
if ".page::before" not in tail:
    fails.append("print guard does not suppress .page::before — the sheet "
                 "stack will print as extra pages")
if "body::before" not in tail:
    fails.append("print guard does not suppress body::before — paper grain "
                 "will print as toner noise")

# ── 7. Reduced motion must come after every animation ───────────────────────
# The craft layer is appended after the main reduced-motion block, so that
# block alone does not catch its animations. CSS resolves equal-specificity
# declarations in source order, so a guard only protects animations declared
# BEFORE it. Check that the LAST guard outranks the LAST animation.
guard = css.rfind("@media (prefers-reduced-motion: reduce)")
if guard < 0:
    fails.append("no prefers-reduced-motion guard, but animations exist")

survivors = [m.start() for m in re.finditer(r"@keyframes\s+", css)]
# `animation: none` is a nullifier inside a guard, not a surviving animation.
for m in re.finditer(r"animation\s*:", css):
    if css[m.end():m.end() + 40].lstrip().startswith("none"):
        continue
    survivors.append(m.start())

if survivors and guard >= 0 and max(survivors) > guard:
    fails.append(
        f"an animation at offset {max(survivors)} is declared after the last "
        f"reduced-motion guard (offset {guard}) and will survive it")

# ── 8. Layout contract: chrome pinned, one scrolling region ────────────────
# Regression guard for "the header and footer are cropped".
# In a flex column, a child will not scroll below its content size unless it
# also declares min-height:0 — and a flex child left to grow pushes the fixed
# chrome off the viewport. Chrome must never grow; content must always scroll.
def rule_body(selector: str) -> str:
    """Return the declarations of the FIRST rule whose selector list contains
    `selector` at the start of a line (avoids matching substrings)."""
    m = re.search(rf"(?m)^\s*{re.escape(selector)}\s*\{{([^}}]*)\}}", css)
    return m.group(1) if m else ""

CHROME = [".bar", ".hud", ".foot"]
# Regions that scroll themselves — they need min-height:0 AND overflow-y:auto.
SCROLLERS = [".setup", ".sessions", ".captions", ".sheet-view"]
# Flex containers that hold a scroller — these need min-height:0 so they can
# shrink, but they do NOT scroll themselves; their child does.
CONTAINERS = [".stage"]

for sel in CHROME:
    body = rule_body(sel)
    if not body:
        fails.append(f"layout: {sel} rule not found — chrome may have lost its pinning")
    elif "flex: 0 0 auto" not in body.replace(" ", " "):
        fails.append(f"layout: {sel} is not flex:0 0 auto — it can grow and "
                     f"push the other chrome off-screen")

for sel in SCROLLERS:
    body = rule_body(sel).replace(" ", " ")
    if not body:
        fails.append(f"layout: {sel} rule not found")
        continue
    if "min-height: 0" not in body:
        fails.append(f"layout: {sel} lacks min-height:0 — as a flex child it "
                     f"cannot scroll and will push the footer off-screen")
    if "overflow-y: auto" not in body:
        fails.append(f"layout: {sel} lacks overflow-y:auto — content will not scroll")

for sel in CONTAINERS:
    body = rule_body(sel).replace(" ", " ")
    if not body:
        fails.append(f"layout: {sel} rule not found")
    elif "min-height: 0" not in body:
        fails.append(f"layout: {sel} lacks min-height:0 — it cannot shrink to "
                     f"fit the viewport alongside the chrome")

# The app shell must be viewport-height, not min-height: min-height lets it
# grow past the viewport, which is what caused the cropping in the first place.
# NOTE: must be anchored — "height: 100dvh" is a substring of
# "min-height: 100dvh", so a plain `in` test would pass on the broken value.
app_body = rule_body(".app")
if not re.search(r"(?m)^\s*height:\s*100dvh\s*;", app_body):
    fails.append("layout: .app must declare height:100dvh (not min-height) so "
                 "the shell cannot grow past the viewport")
if not re.search(r"(?m)^\s*overflow:\s*hidden\s*;", app_body):
    fails.append("layout: .app needs overflow:hidden — regions scroll, not the shell")

# Print must undo the fixed-height shell: paper scrolls the document.
tail_rules = tail + css
if "overflow: visible !important" not in tail_rules:
    fails.append("layout: print does not reset the shell's overflow — the "
                 "sheet will be clipped to one viewport height")

# ── 9. JavaScript must parse ────────────────────────────────────────────────
# THE bug that killed every button. A `const` declared inside a class body is a
# SyntaxError; it breaks the whole module graph, so index.html's inline module
# never executes and not one listener is ever attached. The app looks fine —
# the HUD even renders, from its own constructor — and every button is dead.
# `node --check` catches it in milliseconds.
import shutil
import subprocess
import tempfile

node = shutil.which("node")
if node:
    m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as fh:
        fh.write(m.group(1) if m else "")
        inline_path = fh.name
    targets = [inline_path] + sorted(str(p) for p in WEB.glob("*.js")
                                     if not p.name.endswith(".test.mjs"))
    for path in targets:
        r = subprocess.run([node, "--check", path],
                           capture_output=True, text=True)
        label = "index.html (inline module)" if path == inline_path \
            else f"web/{Path(path).name}"
        if r.returncode != 0:
            first = next((l for l in r.stderr.splitlines() if "Error" in l), r.stderr[:200])
            fails.append(f"syntax error in {label} — the module will not run "
                         f"and every button will be dead: {first.strip()}")
else:
    warns.append("node not found — skipping JS syntax checks")

# ── 10. The UI must never be wired behind a network fetch ───────────────────
# A module-level `await fetch(...)` suspends the ENTIRE module. If that fetch
# never settles — slow host, path outside the service worker scope, airplane
# mode — no listener is ever attached and every button is dead, with no error
# and no console message. This is the exact failure an offline-first product
# cannot ship with.
#
# Function-boundary aware. Tracking braces alone is NOT enough: an `await`
# inside a top-level `if {}` block is still module scope, and a brace-only
# scanner reports it as "inside a block" and skips it. That is precisely how a
# module-scope await survived review here once already.
inline_src = re.search(r'<script type="module">(.*?)</script>', html, re.S)
if inline_src:
    # Line numbers must refer to index.html, not to the extracted snippet.
    # Offset by the newlines preceding the script body, or every finding
    # points at the wrong line and becomes impossible to act on.
    script_start = html.index('<script type="module">') + len('<script type="module">')
    line_offset = html.count("\n", 0, script_start)
    depth = 0
    fn_depths = []          # stack of depths at which a function body opened
    for i, raw in enumerate(inline_src.group(1).splitlines(), 1):
        line = re.sub(r"//.*$", "", raw)
        line = re.sub(r"'[^']*'|\"[^\"]*\"|`[^`]*`", "", line)

        # Control-flow keywords also match a call-then-brace shape but do NOT
        # create a function scope: `if (x) { await ... }` at module level is
        # still module scope. Without excluding them every guarded await in
        # the file reports as a false positive.
        CONTROL = r"(?:if|for|while|switch|catch|do|else|try|finally|function)\b"
        opens_function = bool(
            re.search(r"\bfunction\b", line)
            or re.search(r"=>\s*\{", line)
            or re.search(rf"\b(?:async\s+)?(?!{CONTROL})\w+\s*\([^)]*\)\s*\{{", line)
        )

        # Module scope means: not inside any function body. Evaluated against
        # the state BEFORE this line's braces are applied.
        in_function = bool(fn_depths) and depth >= fn_depths[-1]
        if not in_function and re.search(r"(^|[=(:,\[]\s*)await\b", line):
            fails.append(f"index.html:{i + line_offset} module-scope await — module "
                         f"evaluation blocks on it, so the UI cannot be wired "
                         f"until it settles (this killed every button once)")

        # Order matters: close scopes that ENDED on this line first, then open
        # the new one. Pushing before popping cancels itself out, because the
        # just-pushed depth is immediately <= itself.
        after = depth + line.count("{") - line.count("}")
        # A scope closes only when depth drops BELOW its opening depth.
        # `<=` is wrong: a line with no braces leaves after == fn[-1], which
        # would pop the scope on the very first line of the body.
        while fn_depths and after < fn_depths[-1]:
            fn_depths.pop()
        opens = line.count("{")
        closes = line.count("}")
        # Only push a scope that actually stays open. A one-line arrow such as
        # `.catch(() => {})` opens and closes together; pushing it left a
        # phantom scope at depth 0 that never popped, which silently marked
        # the ENTIRE remainder of the file as "inside a function".
        if opens_function and opens > closes:
            fn_depths.append(after)
        depth = max(0, after)

# ── report ──────────────────────────────────────────────────────────────────
print(f"elements declared : {len(declared)}")
print(f"$() lookups       : {len(used)}")
print(f"css vars defined  : {len(defined)}")
print(f"css vars consumed : {len(consumed)}")
if unused:
    print(f"\nnote — ids declared but not looked up via $(): {unused}")
if warns:
    print("\nwarnings:")
    for w in warns:
        print(f"  - {w}")

if fails:
    print("\nFAIL")
    for f in fails:
        print(f"  x {f}")
    sys.exit(1)

print("\nPASS — no silent-failure classes detected")
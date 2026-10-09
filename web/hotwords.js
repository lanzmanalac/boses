/**
 * Join lesson terms into Whisper previous-text. Empty or omitted means off.
 * @param {string[] | null | undefined} terms
 * @returns {string | null}
 */
export function buildHotwordPrompt(terms) {
  const out = [];
  const seen = new Set();
  for (const raw of terms ?? []) {
    const t = String(raw).trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length ? out.join(', ') : null;
}

// Offline text metrics. These measure ASR errors against a human transcript;
// fixture replay must never be reported as recognition accuracy.

export function normalizeText(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

/** Count edits with a deterministic substitution/deletion/insertion tie-break. */
export function editCounts(reference, hypothesis) {
  const rows = reference.length + 1;
  const cols = hypothesis.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  const step = Array.from({ length: rows }, () => Array(cols).fill(''));
  for (let i = 1; i < rows; i++) { dp[i][0] = i; step[i][0] = 'deletion'; }
  for (let j = 1; j < cols; j++) { dp[0][j] = j; step[0][j] = 'insertion'; }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (reference[i - 1] === hypothesis[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        step[i][j] = 'match';
        continue;
      }
      const choices = [
        [dp[i - 1][j - 1] + 1, 'substitution'],
        [dp[i - 1][j] + 1, 'deletion'],
        [dp[i][j - 1] + 1, 'insertion'],
      ].sort((a, b) => a[0] - b[0]);
      [dp[i][j], step[i][j]] = choices[0];
    }
  }
  let i = reference.length, j = hypothesis.length;
  const counts = { substitutions: 0, deletions: 0, insertions: 0 };
  while (i > 0 || j > 0) {
    const kind = step[i][j];
    if (kind === 'match') { i--; j--; }
    else if (kind === 'substitution') { counts.substitutions++; i--; j--; }
    else if (kind === 'deletion') { counts.deletions++; i--; }
    else if (kind === 'insertion') { counts.insertions++; j--; }
    else throw new Error('Could not align reference and hypothesis');
  }
  return counts;
}

function measure(reference, hypothesis, tokenize) {
  const ref = tokenize(normalizeText(reference));
  const hyp = tokenize(normalizeText(hypothesis));
  const counts = editCounts(ref, hyp);
  const errors = counts.substitutions + counts.deletions + counts.insertions;
  return {
    referenceUnits: ref.length,
    hypothesisUnits: hyp.length,
    ...counts,
    errors,
    rate: ref.length ? errors / ref.length : null,
  };
}

export function wordErrorRate(reference, hypothesis) {
  return measure(reference, hypothesis, (text) => text ? text.split(' ') : []);
}

export function characterErrorRate(reference, hypothesis) {
  return measure(reference, hypothesis, (text) => Array.from(text.replaceAll(' ', '')));
}

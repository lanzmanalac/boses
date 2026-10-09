// Usage: node eval/wer.mjs <human-gold.txt> <raw-asr.txt> [label]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { characterErrorRate, wordErrorRate } from './metrics.mjs';

export async function evaluateFiles(referencePath, hypothesisPath, label = 'lesson') {
  const [reference, hypothesis] = await Promise.all([
    readFile(referencePath, 'utf8'), readFile(hypothesisPath, 'utf8'),
  ]);
  return {
    label,
    referencePath,
    hypothesisPath,
    normalization: 'NFKC lowercase; punctuation removed; spaces ignored for CER',
    wer: wordErrorRate(reference, hypothesis),
    cer: characterErrorRate(reference, hypothesis),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [referencePath, hypothesisPath, label] = process.argv.slice(2);
  if (!referencePath || !hypothesisPath) {
    console.error('Usage: node eval/wer.mjs <human-gold.txt> <raw-asr.txt> [label]');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await evaluateFiles(referencePath, hypothesisPath, label), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

// Evaluate candidate SNR gates on human-labeled utterances. No threshold is
// selected automatically: the team must review the miss/false-accept tradeoff.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeText, wordErrorRate } from './metrics.mjs';

/**
 * Each case: {snrDb, speechPresent, goldText, rawText}. `goldText` is from a
 * human transcript, not fixture output. A no-speech case has goldText:"".
 * @param {{snrDb:number,speechPresent:boolean,goldText:string,rawText:string}[]} cases
 * @param {number[]} thresholds
 */
export function sweepSnr(cases, thresholds = [0, 5, 8, 10, 12, 15, 20]) {
  if (!Array.isArray(cases) || !Array.isArray(thresholds) ||
      cases.some((item) => !Number.isFinite(item?.snrDb) ||
        typeof item.speechPresent !== 'boolean' ||
        typeof item.goldText !== 'string' || typeof item.rawText !== 'string') ||
      thresholds.some((value) => !Number.isFinite(value))) {
    throw new Error('Expected labeled cases with finite snrDb, speechPresent, goldText, rawText, and numeric thresholds');
  }
  return thresholds.map((thresholdDb) => {
    let accepted = 0, rejectedSpeech = 0, acceptedErrors = 0;
    let silenceOutputs = 0, acceptedSilenceOutputs = 0;
    for (const item of cases) {
      const emitted = normalizeText(item.rawText).length > 0;
      if (!item.speechPresent && emitted) silenceOutputs++;
      if (item.snrDb < thresholdDb) {
        if (item.speechPresent) rejectedSpeech++;
        continue;
      }
      accepted++;
      if (!item.speechPresent && emitted) acceptedSilenceOutputs++;
      if (item.speechPresent && wordErrorRate(item.goldText, item.rawText).errors > 0) {
        acceptedErrors++;
      }
    }
    return {
      thresholdDb,
      totalSegments: cases.length,
      acceptedSegments: accepted,
      gapMarkedSegments: cases.length - accepted,
      rejectedSpeechSegments: rejectedSpeech,
      acceptedSpeechWithWordErrors: acceptedErrors,
      rawNoSpeechOutputs: silenceOutputs,
      acceptedNoSpeechOutputs: acceptedSilenceOutputs,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node eval/snr-sweep.mjs <human-labeled-segments.json>');
    process.exitCode = 2;
  } else {
    try {
      const cases = JSON.parse(await readFile(path, 'utf8'));
      console.log(JSON.stringify(sweepSnr(cases), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

// score-run.mjs — Owner: P4.
//
// Scores one live run manifest: raw ASR WER/CER against P2's human reference
// (overall and per human-labeled TL/EN/MIX slice), plus the *displayed* gate
// outcome (accepted coverage, gap rate, no-speech hallucinations) and caption
// latency. The two are reported separately and never mixed: coverage is
// audio-gate pass time, not recognition accuracy.
//
//   node eval/score-run.mjs <run-manifest.json> [--targets targets.json]
//
// Run manifest (schema `boses/run-manifest@1`) — what P1 hands over for each
// device and condition, and what P2's gate log provides for `gaps`/`snrDb`:
//
//   {
//     "schema": "boses/run-manifest@1",
//     "label": "clean / MacBook Air M3",
//     "device": "MacBook Air M3, macOS 15, Chrome 141",
//     "runtime": "WebGPU",                 // "WebGPU" | "WASM"
//     "model": "Xenova/whisper-tiny",
//     "package": "4.3.1",
//     "settings": { "language": "tl", "hotwords": ["photosynthesis"] },
//     "gate": { "snrThresholdDb": 16, "minDurationSec": 0.3, "hangoverSec": 0.5 },
//     "goldPath": "lessons/gold/lesson-clean.labels.txt",  // P2's human labels
//     "segments": [{
//       "id": "seg-1", "start": 0.9, "end": 4.97, "snrDb": 21.4,
//       "latencyMs": 812, "decodeMs": 640,
//       "speechPresent": true,             // false for a noise-only segment
//       "raw": { "text": "Okay class good morning", "outcome": "decoded" },
//       "words": [{ "text": "Okay", "start": 0.9, "end": 1.3, "conf": null }],
//       "gaps": [{ "start": 1.3, "end": 2.0, "reason": { "kind": "low_confidence" } }]
//     }]
//   }
//
// Rules this tool will not break:
//   * A `runtime`/`engine` of `fixture` is refused outright. Fixture replay
//     exercises the UI path; it is never recognition accuracy.
//   * A TL/EN/MIX slice with no human reference is reported as unlabelled, not
//     as a number. Labels are never inferred from recognizer output.
//   * Words displayed to the student are never counted as accurate words.
//   * `conf` is not consulted; this engine has no decoder word confidence.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { deriveCoverage } from '../web/confidence.js';
import { characterErrorRate, wordErrorRate } from './metrics.mjs';

const SLICE_LANGUAGES = ['TL', 'EN', 'MIX'];

/**
 * Parse a P2 human label file: `start end [LANG] text`, one span per line.
 * @param {string} text
 * @returns {{start:number,end:number,lang:string,text:string}[]}
 */
export function parseGoldLabels(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+\[?([A-Za-z]+)\]?\s+(.*)$/u);
      if (!match) throw new Error(`Unreadable human label on line ${index + 1}: ${line}`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error(`Bad times on line ${index + 1} of the human label file`);
      }
      return { start, end, lang: match[3].toUpperCase(), text: match[4].trim() };
    });
}

const overlap = (a, b) => Math.min(a.end, b.end) - Math.max(a.start, b.start);

/** @param {{start:number,end:number}[]} gold @param {{start:number,end:number}[]} segments */
function goldCoveredBy(gold, segments) {
  return segments.filter((segment) => overlap(gold, segment) > 0);
}

/**
 * @param {number[]} values
 * @returns {{count:number,mean:number|null,median:number|null,p95:number|null,max:number|null}}
 */
export function summarizeLatency(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, mean: null, median: null, p95: null, max: null };
  }
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const round = (value) => Math.round(value * 10) / 10;
  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

const join = (parts) => parts.filter(Boolean).join(' ').trim();

/**
 * @typedef {object} RunSegment
 * @property {string} [id]
 * @property {number} start
 * @property {number} end
 * @property {number} [snrDb]
 * @property {number} [latencyMs]
 * @property {number} [decodeMs]
 * @property {boolean} [speechPresent]
 * @property {{text?:string, outcome?:string}} [raw]
 * @property {{text:string,start:number,end:number,conf:number|null}[]} [words]
 * @property {{start:number,end:number,reason:{kind:string}}}[] [gaps]
 */

/**
 * Score one live run. `gold` is P2's human-labeled spans, already parsed.
 * @param {object} manifest
 * @param {{start:number,end:number,lang:string,text:string}[]} [gold]
 * @returns {object}
 */
export function scoreRun(manifest, gold = []) {
  const runtime = String(manifest?.runtime ?? '').toLowerCase();
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('A run manifest object is required');
  }
  if (runtime === 'fixture' || manifest?.engine === 'fixture') {
    throw new Error('Fixture replay is a UI check, not recognition accuracy; score recorded audio');
  }
  /** @type {RunSegment[]} */
  const segments = (manifest.segments ?? []).slice()
    .sort((a, b) => a.start - b.start);
  if (segments.some((segment) => !Number.isFinite(segment?.start) ||
      !Number.isFinite(segment?.end) || segment.end <= segment.start)) {
    throw new Error('Every run segment needs finite start and end times');
  }

  const rawOf = (segment) => String(segment.raw?.text ?? '').trim();
  const displayedOf = (segment) => (segment.words ?? [])
    .map((word) => String(word?.text ?? '')).filter(Boolean).join(' ').trim();

  // ── Raw ASR accuracy, against the human spans the decoded audio covered ──
  const measuredGold = gold.filter((span) => goldCoveredBy(span, segments).length > 0);
  const scoreText = (label, reference, hypothesis, extra = {}) => ({
    label,
    status: reference ? 'scored' : 'no human reference',
    reference,
    hypothesis,
    ...(reference ? {
      wer: wordErrorRate(reference, hypothesis).rate,
      cer: characterErrorRate(reference, hypothesis).rate,
      ...wordErrorRate(reference, hypothesis),
    } : {}),
    ...extra,
  });

  const allReference = join(measuredGold.map((span) => span.text));
  const allRaw = join(segments
    .filter((segment) => measuredGold.some((span) => overlap(span, segment) > 0))
    .map(rawOf));
  const slices = {};
  for (const lang of SLICE_LANGUAGES) {
    const spans = measuredGold.filter((span) => span.lang === lang);
    const covered = spans.filter((span) => goldCoveredBy(span, segments).length > 0);
    slices[lang] = scoreText(
      `${lang} subset`,
      covered.length ? join(covered.map((span) => span.text)) : '',
      join(segments.filter((segment) => covered.some((span) =>
        overlap(span, segment) > 0)).map(rawOf)),
      { goldSpans: spans.length, scoredSpans: covered.length },
    );
  }

  // ── Displayed outcome: what the student actually saw ──
  const coverage = deriveCoverage(segments);
  const gapKinds = {};
  let gapSegments = 0;
  let wordSegments = 0;
  for (const segment of segments) {
    if ((segment.gaps ?? []).length) gapSegments += 1;
    if ((segment.words ?? []).length) wordSegments += 1;
    for (const gap of segment.gaps ?? []) {
      const kind = gap?.reason?.kind ?? 'unknown';
      const seconds = Math.max(0, (gap.end ?? 0) - (gap.start ?? 0));
      gapKinds[kind] = Math.round(((gapKinds[kind] ?? 0) + seconds) * 1000) / 1000;
    }
  }
  const noSpeech = segments.filter((segment) => segment.speechPresent === false);
  const noSpeechHallucinations = noSpeech.filter((segment) =>
    displayedOf(segment) || rawOf(segment));

  // ── Failure attribution for the acceptance run's fix-and-repeat step ──
  const diagnostics = [];
  const uncovered = gold.filter((span) => goldCoveredBy(span, segments).length === 0);
  if (uncovered.length) {
    diagnostics.push({ lane: 'P2', issue: 'human speech produced no segment',
      detail: uncovered.map((span) => span.text) });
  }
  for (const span of measuredGold) {
    const touching = goldCoveredBy(span, segments);
    const gapKindsHere = new Set(touching.flatMap((segment) =>
      (segment.gaps ?? []).map((gap) => gap?.reason?.kind)));
    if (gapKindsHere.has('snr_below_threshold') || gapKindsHere.has('too_short')) {
      diagnostics.push({ lane: 'P2', issue: 'clear speech gated out by the capture settings',
        detail: [span.text] });
    }
    if (gapKindsHere.has('repetition_suppressed')) {
      diagnostics.push({ lane: 'P2', issue: 'repetition suppression dropped spoken text',
        detail: [span.text] });
    }
    const rawText = join(touching.map(rawOf));
    if (rawText && wordErrorRate(span.text, rawText).errors > 0) {
      diagnostics.push({ lane: 'P1', issue: 'raw recognizer text does not match the reference',
        detail: [{ reference: span.text, raw: rawText }] });
    }
    const shownText = join(touching.map(displayedOf));
    if (!shownText && rawText && !gapKindsHere.size) {
      diagnostics.push({ lane: 'P4', issue: 'gated words were dropped without a gap reason',
        detail: [{ raw: rawText }] });
    }
  }

  return {
    label: manifest.label ?? null,
    provenance: {
      device: manifest.device ?? null,
      runtime: manifest.runtime ?? null,
      model: manifest.model ?? null,
      package: manifest.package ?? null,
      settings: manifest.settings ?? null,
      gate: manifest.gate ?? null,
      goldPath: manifest.goldPath ?? null,
      segments: segments.length,
      goldSpans: gold.length,
    },
    rawAsr: scoreText('raw ASR, all slices', allReference, allRaw),
    rawAsrBySlice: slices,
    displayed: {
      note: 'Accepted coverage is audio-gate pass time, not model confidence or accuracy.',
      coverage,
      segmentsWithWords: wordSegments,
      segmentsWithGaps: gapSegments,
      gapRate: segments.length ? gapSegments / segments.length : null,
      gapSecondsByReason: gapKinds,
      wordsShownUnverified: (segments ?? []).every((segment) =>
        (segment.words ?? []).every((word) => word?.conf === null)),
    },
    noSpeech: {
      segments: noSpeech.length,
      hallucinatedSegments: noSpeechHallucinations.length,
      detail: noSpeechHallucinations.map((segment) => ({
        id: segment.id ?? null,
        start: segment.start,
        raw: rawOf(segment),
        displayed: displayedOf(segment),
      })),
    },
    latencyMs: {
      caption: summarizeLatency(segments.map((segment) => segment.latencyMs)),
      decode: summarizeLatency(segments.map((segment) => segment.decodeMs)),
    },
    diagnostics,
  };
}

/**
 * Compare a scored run against the targets the team agreed before the run.
 * A target with no measurement is never treated as a pass.
 * @param {object} report
 * @param {{maxWer?:number,maxCer?:number,maxLatencyP95Ms?:number,
 *   maxNoSpeechHallucinations?:number,minCoverageRatio?:number}} targets
 */
export function compareTargets(report, targets = {}) {
  const rows = [];
  const add = (metric, value, limit, better) => {
    if (limit === undefined || limit === null) return;
    if (value === null || value === undefined) {
      rows.push({ metric, measured: null, target: limit, verdict: 'not measured' });
      return;
    }
    const pass = better === 'min' ? value >= limit : value <= limit;
    rows.push({ metric, measured: value, target: limit,
      verdict: pass ? 'met' : 'not met' });
  };
  add('WER (raw ASR)', report.rawAsr.wer, targets.maxWer, 'max');
  add('CER (raw ASR)', report.rawAsr.cer, targets.maxCer, 'max');
  add('latency p95 (ms)', report.latencyMs.caption.p95, targets.maxLatencyP95Ms, 'max');
  // A run with no noise-only audio has not demonstrated anything about
  // hallucination; zero observed is not zero risk.
  add('no-speech hallucinations',
    report.noSpeech.segments ? report.noSpeech.hallucinatedSegments : null,
    targets.maxNoSpeechHallucinations, 'max');
  add('accepted coverage ratio',
    report.displayed.coverage.totalSec ? report.displayed.coverage.coverageRatio : null,
    targets.minCoverageRatio, 'min');
  return rows;
}

async function readManifest(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.goldPath) {
    const goldUrl = new URL(manifest.goldPath, pathToFileURL(`${process.cwd()}/`));
    manifest.goldLabels = parseGoldLabels(await readFile(goldUrl, 'utf8'));
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, , targetsPath] = process.argv.slice(2);
  if (!manifestPath) {
    console.error('Usage: node eval/score-run.mjs <run-manifest.json> [--targets targets.json]');
    process.exitCode = 2;
  } else {
    try {
      const manifest = await readManifest(manifestPath);
      const targets = targetsPath
        ? JSON.parse(await readFile(targetsPath, 'utf8')) : undefined;
      const report = scoreRun(manifest, manifest.goldLabels ?? []);
      const output = targets ? { ...report, targets: compareTargets(report, targets) } : report;
      console.log(JSON.stringify(output, null, 2));
      if (targets && output.targets.some((row) => row.verdict !== 'met')) {
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
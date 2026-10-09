// contracts.ts — FROZEN. Import this, don't copy it.
// If this is wrong, say so in chat and fix it here for everyone.
//
// Baseline is section 3 of Boses-Parallel-Build-Plan.md, committed verbatim.
// Two fields are added because ARCHITECTURE.md mandates them and the
// plan's own T+0.5 checklist requires them ("including the nullable conf"):
//
//   1. Word.conf is NULLABLE.   (ARCHITECTURE.md §4 — "Nullable makes the
//                                degradation explicit"; a non-null field would
//                                force us to invent a number, which is the
//                                precise failure mode this product exists to
//                                prevent.)
//   2. AsrEngine.supportsWordConfidence: boolean.  (ADR-0002. Lets the gap
//                                marker degrade honestly instead of pretending.)
//
// Rule for everyone: a word may have conf: null when the decoder has no score;
// a failed or unusable decode is a Gap with no words.

export type Confidence = number | null; // 0..1, decoder-derived; null = unavailable
export type EngineId = 'whisper-webgpu' | 'whisper-wasm' | 'fixture';

export interface GapReason {
  kind:
    | 'low_confidence'        // decoder confidence below threshold
    | 'snr_below_threshold'   // segment too noisy — decoder was skipped entirely
    | 'too_short'             // segment shorter than a plausible word
    | 'repetition_suppressed'; // detected Whisper hallucination loop
  alternatives?: string[];    // ALWAYS rendered as uncertain in the UI
}

export interface Word {
  text: string;
  start: number;   // seconds from session start
  end: number;
  conf: Confidence;
}

export interface Gap {
  start: number;
  end: number;
  reason: GapReason;
}

export interface RawDecode {
  text: string;
  decodeMs: number | null;
  outcome: string;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  snrDb: number;         // estimated by capture — used by confidence gating
  words: Word[];         // LOW-CONFIDENCE WORDS ARE OMITTED FROM HERE
  gaps: Gap[];           // and represented here instead
  engine: EngineId;
  latencyMs: number;     // utterance close -> segment ready
  raw?: RawDecode;
}

export interface TranscribeOptions {
  startSec: number;
  hotwords: string[];
  snrDb: number;
  snrThresholdDb: number;
}

export interface AsrEngine {
  readonly id: EngineId;
  /** ADR-0002: false when the decoder exposes no per-token confidence. */
  readonly supportsWordConfidence: boolean;
  init(onProgress?: (p: number) => void): Promise<void>;
  transcribe(pcm: Float32Array, opts: TranscribeOptions): Promise<TranscriptSegment>;
  dispose(): Promise<void>;
}

export interface FlaggedSpan {
  start: number;
  end: number;
  text: string;
  reason: 'user_flagged' | GapReason['kind'];
}

export interface VocabItem {
  term: string;
  count: number;
  tl?: string;      // paired Filipino form if both were spoken
  en?: string;      // paired English form if both were spoken
}

export interface LessonSession {
  id: string;
  startedAt: number;             // epoch ms
  title: string;
  segments: TranscriptSegment[]; // append-only during the session
  flags: FlaggedSpan[];          // "I missed this"
  vocab: VocabItem[];            // filled at session end
  summaryLines: string[];        // deterministic template output
  llmDraft?: string;             // optional, cosmetic only
}

export interface CoverageStats {
  totalSec: number;
  confidentSec: number;   // segments transcribed with acceptable confidence
  uncertainSec: number;   // segments represented as gaps
  coverageRatio: number;  // confidentSec / totalSec
}
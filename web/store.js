// store.js — Owner: P4.
// Private, device-local text sessions. Write each segment as it arrives so a
// closed tab or drained phone does not erase the whole lesson.

/** @typedef {import('../contracts.ts').LessonSession} LessonSession */
/** @typedef {import('../contracts.ts').TranscriptSegment} TranscriptSegment */
/** @typedef {import('../contracts.ts').FlaggedSpan} FlaggedSpan */

export { extractVocab } from './vocab.js';
export { buildSummary } from './summary.js';

const DB_NAME = 'boses-sessions';
const STORE_NAME = 'sessions';
const DB_VERSION = 1;
let opening;

/** @param {unknown} value */
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

/** @param {string} id @returns {LessonSession} */
function emptySession(id) {
  return {
    id, startedAt: Date.now(), title: 'Lesson', segments: [], flags: [],
    vocab: [], summaryLines: [],
  };
}

function openDb() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('IndexedDB is unavailable on this device'));
  }
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = undefined;
      reject(request.error ?? new Error('Could not open local session storage'));
    };
    request.onblocked = () => {
      opening = undefined;
      reject(new Error('Local session storage is blocked by another open tab'));
    };
  });
  return opening;
}

/** @param {string} id */
function validId(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('A nonempty session id is required');
  }
}

/**
 * Read, change, and write a session in one IndexedDB transaction. IndexedDB
 * serializes readwrite transactions on this store, so segment and flag writes
 * cannot overwrite one another even if the UI triggers them together.
 * @param {string} id
 * @param {(existing: LessonSession) => LessonSession} update
 * @returns {Promise<LessonSession>}
 */
async function changeSession(id, update) {
  validId(id);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let next;
    tx.oncomplete = () => resolve(copy(next));
    tx.onerror = () => reject(tx.error ?? new Error('Could not save the lesson'));
    tx.onabort = () => reject(tx.error ?? new Error('Lesson save was aborted'));
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        next = update(copy(request.result ?? emptySession(id)));
        if (!next || next.id !== id) {
          throw new Error('Session update changed its id');
        }
        store.put(copy(next));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
  });
}

/** Set the title and start time while preserving any already-saved segments. */
export function beginSession(session) {
  validId(session?.id);
  return changeSession(session.id, (existing) => ({
    ...existing,
    startedAt: session.startedAt,
    title: session.title || existing.title,
  }));
}

/**
 * Checkpoint one new segment immediately. Duplicate ids are ignored so
 * replays and retries cannot insert the same caption twice.
 * @param {string} sessionId
 * @param {TranscriptSegment} segment
 */
export function appendSegment(sessionId, segment) {
  if (typeof segment?.id !== 'string' || !segment.id.trim()) {
    throw new Error('A segment id is required');
  }
  return changeSession(sessionId, (existing) => {
    if (existing.segments.some((item) => item.id === segment.id)) return existing;
    return { ...existing, segments: [...existing.segments, copy(segment)] };
  });
}

/** @param {string} sessionId @param {FlaggedSpan[]} flags */
export function saveFlags(sessionId, flags) {
  if (!Array.isArray(flags)) throw new Error('flags must be an array');
  return changeSession(sessionId, (existing) => ({
    ...existing, flags: copy(flags),
  }));
}

/** Save the final vocabulary and summary alongside the transcript. */
export function finalizeSession(session) {
  validId(session?.id);
  if (!Array.isArray(session.segments) || !Array.isArray(session.flags) ||
      !Array.isArray(session.vocab) || !Array.isArray(session.summaryLines)) {
    throw new Error('Finalized session must contain segments, flags, vocab, and summaryLines arrays');
  }
  return changeSession(session.id, (existing) => {
    // Keep a checkpoint that reached IndexedDB while the end-of-class action
    // was being prepared. The final session may add processed versions of the
    // same ids; those replace the earlier checkpoint copies.
    const segments = new Map(existing.segments.map((item) => [item.id, item]));
    for (const item of session.segments) segments.set(item.id, item);
    const flags = new Map(existing.flags.map((item) =>
      [JSON.stringify([item.start, item.end, item.text, item.reason]), item]));
    for (const item of session.flags) {
      flags.set(JSON.stringify([item.start, item.end, item.text, item.reason]), item);
    }
    return {
      ...existing, ...copy(session),
      segments: [...segments.values()].sort((a, b) => a.start - b.start),
      flags: [...flags.values()],
    };
  });
}

/** @param {string} id @returns {Promise<LessonSession | null>} */
export async function getSession(id) {
  validId(id);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(copy(request.result ?? null));
    request.onerror = () => reject(request.error ?? new Error('Could not read the lesson'));
  });
}

/** @returns {Promise<LessonSession[]>} */
export async function listSessions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(copy(request.result).sort(
      (a, b) => b.startedAt - a.startedAt));
    request.onerror = () => reject(request.error ?? new Error('Could not list lessons'));
  });
}

/** @param {string} id */
export async function deleteSession(id) {
  validId(id);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not delete the lesson'));
    tx.objectStore(STORE_NAME).delete(id);
  });
}

/** Permanent, one-tap deletion of all locally saved lessons. */
export async function deleteAllSessions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not delete lessons'));
    tx.objectStore(STORE_NAME).clear();
  });
}

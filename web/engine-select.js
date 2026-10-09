// engine-select.js — Owner: P4.
// ?fixture=1 (or clean/noisy/taglish) selects deterministic replay. Import the
// real ASR module only on the real path so fixture mode works before P1 merges.

import { FixtureEngine } from './fixture.js';

/** @param {string} [search] */
export async function selectEngine(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  if (params.has('fixture')) {
    const requested = params.get('fixture');
    const fixture = !requested || requested === '1' ? 'clean' : requested;
    return new FixtureEngine({ fixture });
  }

  // P1 owns asr.js and may still be building it. This import must stay inside
  // the non-fixture branch; a static import would break the offline demo.
  const { WhisperEngine } = await import('./asr.js');
  if (typeof WhisperEngine !== 'function') {
    throw new Error('web/asr.js must export a WhisperEngine class');
  }
  return new WhisperEngine();
}

export default await selectEngine();

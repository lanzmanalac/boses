// The page uses an inline module script, so exercise its real binding installer
// here. A detached object assignment once left every optional module null and
// turned all live captions into gaps despite successful imports.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('boot installs post-class modules into the bindings used by the page', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const installer = html.match(/function installPostClassModule\(slot, mod\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(installer, 'the page must define a module installer');

  const boot = html.split('async function boot() {')[1]?.split('// 2 — storage.')[0];
  assert.ok(boot, 'the page must load optional modules during boot');
  assert.match(boot, /installPostClassModule\(slot, mod\)/);

  const makeHarness = new Function(`
    let confidence = null, taglish = null, vocabMod = null, summaryMod = null;
    ${installer}
    return {
      install: installPostClassModule,
      bindings: () => ({ confidence, taglish, vocabMod, summaryMod }),
    };
  `);
  const { install, bindings } = makeHarness();
  for (const slot of ['confidence', 'taglish', 'vocabMod', 'summaryMod']) {
    const module = { slot };
    install(slot, module);
    assert.equal(bindings()[slot], module, `${slot} must update its live binding`);
  }
  assert.throws(() => install('unknown', {}), /Unknown post-class module/);
});

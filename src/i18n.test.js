import assert from 'node:assert/strict';
import { test } from 'node:test';

// i18n.js reads localStorage on load; node has none, which is the "storage blocked" path.
const { ID } = await import('./i18n.js');

const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join();

test('every Indonesian text is unique, so switching back to English is unambiguous', () => {
  const seen = new Map();
  for (const [en, id] of Object.entries(ID)) {
    assert.ok(!seen.has(id), `"${id}" is used for both "${seen.get(id)}" and "${en}"`);
    seen.set(id, en);
  }
});

test('translations keep the same placeholders as their English source', () => {
  for (const [en, id] of Object.entries(ID)) assert.equal(placeholders(id), placeholders(en), en);
});

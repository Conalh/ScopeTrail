import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('compiled CLI entrypoint exists', () => {
  assert.equal(existsSync(new URL('../dist/index.js', import.meta.url)), true);
});

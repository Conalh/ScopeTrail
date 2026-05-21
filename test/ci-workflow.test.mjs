import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

test('repository has public CI for build and tests', async () => {
  const workflow = await readFile(join(packageRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /^name:\s*CI/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm test/);
});

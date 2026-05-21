import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

test('repository dogfoods the local ScopeTrail action on pull requests', async () => {
  const workflow = await readFile(join(packageRoot, '.github', 'workflows', 'scopetrail.yml'), 'utf8');

  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /uses:\s*\.\/$/m);
  assert.match(workflow, /fail-on:\s*none/);
});

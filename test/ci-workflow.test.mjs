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
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  // Matrix covers Node >= engines.node (20) plus the next LTS lines.
  assert.match(workflow, /node-version:\s*\[\s*20\s*,\s*22\s*,\s*24\s*\]/);
  assert.match(workflow, /node-version:\s*\$\{\{\s*matrix\.node-version\s*\}\}/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm test/);
});

test('package.json declares the supported Node range', async () => {
  // agent-gov-core@>=0.7 declares engines.node: ">=20". Without ScopeTrail
  // declaring its own engines, `npm install` on Node 18 produces no warning
  // and the failure mode is a confusing runtime error from the dependency.
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.engines?.node, '>=20');
});

test('CI verifies committed Action runtime is current after build', async () => {
  const workflow = await readFile(join(packageRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /git diff --exit-code -- dist/);
  assert.match(workflow, /git status --short -- dist/);
});

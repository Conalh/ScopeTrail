import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

test('GitHub Action metadata exposes PR drift inputs', async () => {
  const action = await readFile(join(packageRoot, 'action.yml'), 'utf8');

  assert.match(action, /^name:\s*ScopeTrail/m);
  assert.match(action, /^author:\s*Conal/m);
  assert.match(action, /^branding:/m);
  assert.match(action, /using:\s*['"]?composite['"]?/);
  assert.match(action, /^  repo:/m);
  assert.match(action, /^  base:/m);
  assert.match(action, /^  head:/m);
  assert.match(action, /^  fail-on:/m);
  assert.match(action, /^  finding-count:/m);
  assert.match(action, /GITHUB_STEP_SUMMARY/);
  assert.match(action, /diff --repo/);
  assert.match(action, /--format github/);
});

test('README Action install tag matches package version', async () => {
  const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const version = packageJson.version;

  assert.equal(version, '0.1.6');
  assert.match(readme, new RegExp(`Conalh/ScopeTrail@v${version.replaceAll('.', '\\.')}`));
});

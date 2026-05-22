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

test('GitHub Action uses committed runtime without installing dependencies in consumer workflows', async () => {
  const action = await readFile(join(packageRoot, 'action.yml'), 'utf8');
  const gitignore = await readFile(join(packageRoot, '.gitignore'), 'utf8');

  assert.match(action, /node "\$GITHUB_ACTION_PATH\/dist\/index\.js" diff --repo/);
  assert.doesNotMatch(action, /npm ci/);
  assert.doesNotMatch(action, /npm run build/);
  assert.doesNotMatch(gitignore, /^dist\/$/m);
});

test('public Action install tags match package version', async () => {
  const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
  const pilotGuide = await readFile(join(packageRoot, 'docs', 'PILOT.md'), 'utf8');
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const installTagPattern = new RegExp(`Conalh/ScopeTrail@v${version.replaceAll('.', '\\.')}`);

  assert.equal(version, '0.1.10');
  assert.match(readme, installTagPattern);
  assert.match(pilotGuide, installTagPattern);
});

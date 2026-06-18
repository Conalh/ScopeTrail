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
  assert.match(action, /diff [\\\s]*--repo/);
  assert.match(action, /--format github/);
  assert.match(action, /--out-markdown/);
  assert.match(action, /--out-json/);
  // Threshold logic lives in the CLI, not bash — see src/report.ts's
  // meetsFailOnThreshold. The action forwards the fail-on input.
  assert.match(action, /--fail-on "?\$\{?fail_on/);
  assert.doesNotMatch(action, /rank\(\)\s*\{/);
});

test('GitHub Action invokes the ScopeTrail CLI once per run', async () => {
  // Before this change the action invoked `node $GITHUB_ACTION_PATH/dist/index.js`
  // three separate times (markdown / json / github) and each call
  // re-materialized both git snapshots and re-ran every detector. The
  // single-scan refactor renders all three outputs from one run.
  const action = await readFile(join(packageRoot, 'action.yml'), 'utf8');
  const invocations = action.match(/node "\$GITHUB_ACTION_PATH\/dist\/index\.js"/g) ?? [];
  assert.equal(
    invocations.length,
    1,
    `expected exactly one CLI invocation in action.yml, found ${invocations.length}`
  );
});

test('GitHub Action uses committed dist and a deps-only install (no build) in consumer workflows', async () => {
  const action = await readFile(join(packageRoot, 'action.yml'), 'utf8');
  const gitignore = await readFile(join(packageRoot, '.gitignore'), 'utf8');

  // Tolerant of line continuations (`\`) between `diff` and `--repo`
  // so the single-scan refactor can split the invocation across
  // lines for readability.
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/dist\/index\.js" diff[\\\s]+--repo/);
  // dist/ is committed so consumers don't run a TypeScript build at action time.
  assert.doesNotMatch(action, /npm run build/);
  assert.doesNotMatch(action, /tsc /);
  assert.doesNotMatch(gitignore, /^dist\/$/m);
  // After the agent-gov-core migration the action installs runtime deps only
  // (--omit=dev) so the external import resolves without a build step.
  assert.match(action, /npm ci .*--omit=dev/);
});

test('public Action install tags match package version', async () => {
  const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
  const pilotGuide = await readFile(join(packageRoot, 'docs', 'PILOT.md'), 'utf8');
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const installTagPattern = new RegExp(`Conalh/ScopeTrail@v${version.replaceAll('.', '\\.')}`);

  assert.equal(version, '0.3.3');
  assert.match(readme, installTagPattern);
  assert.match(pilotGuide, installTagPattern);
});

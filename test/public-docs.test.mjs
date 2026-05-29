import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

async function readProjectFile(...parts) {
  return readFile(join(packageRoot, ...parts), 'utf8');
}

test('README surfaces the canonical GitHub Action setup', async () => {
  // The deeper trust / adoption / pilot rationale lives in docs/ and is
  // asserted by the doc-specific tests below. The README is intentionally
  // kept tight after the v0.2 rewrite, but it must still teach a stranger
  // the minimum viable Action install: pinned tag, fetch-depth, fail-on.
  const readme = await readProjectFile('README.md');
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const installTagPattern = new RegExp(`Conalh/ScopeTrail@v${packageJson.version.replaceAll('.', '\\.')}`);

  assert.match(readme, installTagPattern);
  assert.match(readme, /fetch-depth:\s*0/);
  assert.match(readme, /fail-on:\s*none/);
});

test('trust doc describes local-only advisory GitHub Action behavior', async () => {
  const trust = await readProjectFile('docs', 'TRUST.md');

  assert.match(trust, /reads the checked-out repository/i);
  assert.match(trust, /uploads nothing by default/i);
  assert.match(trust, /runs the committed `dist\/` runtime/i);
  assert.match(trust, /runs `npm ci --omit=dev` inside the ScopeTrail Action directory/i);
  assert.match(trust, /does not run `npm run build` in the installing repository/i);
  assert.match(trust, /permissions:\s*`contents: read`/i);
  assert.match(trust, /`fetch-depth: 0`/);
  assert.match(trust, /`fail-on: none`/);
  assert.match(trust, /does not provide a security guarantee/i);
});

test('public docs describe active and sample MCP config coverage', async () => {
  // The v0.2 README rewrite stopped enumerating every sample-file variant
  // inline (it was a wall of filenames). The detail still belongs in the
  // trust and pilot docs, which are what reviewers and adopters actually
  // read when deciding scope. README only needs to mention that the
  // detectors cover sample/template variants in general.
  const readme = await readProjectFile('README.md');
  const trust = await readProjectFile('docs', 'TRUST.md');
  const pilot = await readProjectFile('docs', 'PILOT.md');

  assert.match(readme, /sample\/template\/disabled/i);
  assert.match(trust, /sample\/template\/disabled MCP config files/i);
  assert.match(trust, /platform-suffixed MCP example files/i);
  assert.match(trust, /prefixed MCP config example files/i);
  assert.match(pilot, /sample\/template\/disabled MCP config findings/i);
  assert.match(pilot, /prefixed MCP config examples/i);
});

test('adoption checklist defines advisory-first rollout and feedback path', async () => {
  const adoption = await readProjectFile('docs', 'ADOPTION.md');

  assert.match(adoption, /Install ScopeTrail with `fail-on: none`/);
  assert.match(adoption, /Run it for 3-5 pull requests/);
  assert.match(adoption, /inline annotations and step summaries/i);
  assert.match(adoption, /false-positive report/i);
  assert.match(adoption, /missing-surface request/i);
  assert.match(adoption, /raise `fail-on`/i);
});

test('pilot guide gives external maintainers a complete advisory trial path', async () => {
  // README no longer deep-links the pilot guide directly — pilot adopters
  // reach it via the active pilot issue (linked from the README) or via
  // ADOPTION.md. The pilot guide itself still needs to stand on its own.
  const readme = await readProjectFile('README.md');
  const adoption = await readProjectFile('docs', 'ADOPTION.md');
  const pilot = await readProjectFile('docs', 'PILOT.md');
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const installTagPattern = new RegExp(`Conalh/ScopeTrail@v${packageJson.version.replaceAll('.', '\\.')}`);

  assert.match(readme, /issues\/18/);
  assert.match(adoption, /\[Pilot guide\]\(PILOT\.md\)/);
  assert.match(pilot, installTagPattern);
  assert.match(pilot, /fail-on:\s*none/);
  assert.match(pilot, /3-5 pull requests/i);
  assert.match(pilot, /https:\/\/github\.com\/Conalh\/ScopeTrail\/issues\/18/);
  assert.match(pilot, /cross-repo visibility/i);
});

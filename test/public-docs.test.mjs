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

test('README links trust, adoption, and pilot docs from the public Action surface', async () => {
  const readme = await readProjectFile('README.md');

  assert.match(readme, /\[Trust and permissions\]\(docs\/TRUST\.md\)/);
  assert.match(readme, /\[Adoption checklist\]\(docs\/ADOPTION\.md\)/);
  assert.match(readme, /\[Pilot guide\]\(docs\/PILOT\.md\)/);
  assert.match(readme, /install with `fail-on: none`/i);
  assert.match(readme, /runs the committed `dist\/` runtime/i);
  assert.match(readme, /runs `npm ci --omit=dev` inside the ScopeTrail Action directory/i);
  assert.match(readme, /does not run `npm run build`/i);
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
  const readme = await readProjectFile('README.md');
  const trust = await readProjectFile('docs', 'TRUST.md');
  const pilot = await readProjectFile('docs', 'PILOT.md');

  assert.match(readme, /sample\/template\/disabled MCP config drift/i);
  assert.match(readme, /\.mcp\.json\.sample/);
  assert.match(readme, /\.mcp\.json\.windows\.example/);
  assert.match(readme, /mcp_config\.json\.example/);
  assert.match(readme, /example_mcp_config\.json/);
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
  assert.match(adoption, /warning annotations and step summaries/i);
  assert.match(adoption, /false-positive report/i);
  assert.match(adoption, /missing-surface request/i);
  assert.match(adoption, /raise `fail-on`/i);
});

test('pilot guide gives external maintainers a complete advisory trial path', async () => {
  const readme = await readProjectFile('README.md');
  const adoption = await readProjectFile('docs', 'ADOPTION.md');
  const pilot = await readProjectFile('docs', 'PILOT.md');
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const installTagPattern = new RegExp(`Conalh/ScopeTrail@v${packageJson.version.replaceAll('.', '\\.')}`);

  assert.match(readme, /\[Pilot guide\]\(docs\/PILOT\.md\)/);
  assert.match(adoption, /\[Pilot guide\]\(PILOT\.md\)/);
  assert.match(pilot, installTagPattern);
  assert.match(pilot, /fail-on:\s*none/);
  assert.match(pilot, /3-5 pull requests/i);
  assert.match(pilot, /https:\/\/github\.com\/Conalh\/ScopeTrail\/issues\/18/);
  assert.match(pilot, /cross-repo visibility/i);
});

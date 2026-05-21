import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

async function readIssueTemplate(name) {
  return readFile(join(packageRoot, '.github', 'ISSUE_TEMPLATE', name), 'utf8');
}

test('issue templates collect detector feedback signals', async () => {
  const falsePositive = await readIssueTemplate('false-positive.yml');
  const missingSurface = await readIssueTemplate('missing-surface.yml');

  assert.match(falsePositive, /labels:\s*\["detector", "false-positive"\]/);
  assert.match(falsePositive, /id:\s*scope/);
  assert.match(falsePositive, /label:\s*Affected scope/);
  assert.match(falsePositive, /id:\s*repository-count/);

  assert.match(missingSurface, /labels:\s*\["detector", "new-surface"\]/);
  assert.match(missingSurface, /id:\s*scope/);
  assert.match(missingSurface, /label:\s*Affected scope/);
  assert.match(missingSurface, /id:\s*review-surface/);
});

test('team adoption issue template collects paid-layer validation signals without promising SaaS', async () => {
  const teamAdoption = await readIssueTemplate('team-adoption.yml');

  assert.match(teamAdoption, /labels:\s*\["validation", "team-adoption"\]/);
  assert.match(teamAdoption, /id:\s*repository-count/);
  assert.match(teamAdoption, /label:\s*Repository count/);
  assert.match(teamAdoption, /id:\s*agent-tools/);
  assert.match(teamAdoption, /id:\s*permission-owner/);
  assert.match(teamAdoption, /id:\s*trust-criteria/);
  assert.match(teamAdoption, /id:\s*paid-workflow-pain/);
  assert.match(teamAdoption, /product validation/i);
  assert.doesNotMatch(teamAdoption, /SaaS is available/i);
});

test('pilot result issue template collects auditable external validation evidence', async () => {
  const pilotResult = await readIssueTemplate('pilot-result.yml');

  assert.match(pilotResult, /labels:\s*\["validation", "pilot-result"\]/);
  assert.match(pilotResult, /id:\s*pilot-source/);
  assert.match(pilotResult, /id:\s*repository-count/);
  assert.match(pilotResult, /id:\s*agent-tools/);
  assert.match(pilotResult, /id:\s*install-status/);
  assert.match(pilotResult, /id:\s*useful-findings/);
  assert.match(pilotResult, /id:\s*noisy-findings/);
  assert.match(pilotResult, /id:\s*missing-surfaces/);
  assert.match(pilotResult, /id:\s*team-workflow-requested/);
  assert.match(pilotResult, /id:\s*would-keep-installed/);
  assert.match(pilotResult, /product validation/i);
  assert.match(pilotResult, /paid team layer is not available yet/i);
  assert.doesNotMatch(pilotResult, /SaaS is available/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

test('issue templates collect detector feedback signals', async () => {
  const falsePositive = await readFile(
    join(packageRoot, '.github', 'ISSUE_TEMPLATE', 'false-positive.yml'),
    'utf8'
  );
  const missingSurface = await readFile(
    join(packageRoot, '.github', 'ISSUE_TEMPLATE', 'missing-surface.yml'),
    'utf8'
  );

  assert.match(falsePositive, /labels:\s*\["detector", "false-positive"\]/);
  assert.match(falsePositive, /id:\s*scope/);
  assert.match(falsePositive, /label:\s*Affected scope/);
  assert.match(falsePositive, /id:\s*repository-count/);

  assert.match(missingSurface, /labels:\s*\["detector", "new-surface"\]/);
  assert.match(missingSurface, /id:\s*scope/);
  assert.match(missingSurface, /label:\s*Affected scope/);
  assert.match(missingSurface, /id:\s*review-surface/);
});

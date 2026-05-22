import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
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
  const teamAdoption = await readIssueTemplate('team-adoption.yml');

  assert.match(falsePositive, /labels:\s*\["detector", "false-positive"\]/);
  assert.match(falsePositive, /id:\s*scope/);
  assert.match(falsePositive, /label:\s*Affected scope/);
  assert.match(falsePositive, /id:\s*repository-count/);

  assert.match(missingSurface, /labels:\s*\["detector", "new-surface"\]/);
  assert.match(missingSurface, /id:\s*scope/);
  assert.match(missingSurface, /label:\s*Affected scope/);
  assert.match(missingSurface, /id:\s*review-surface/);

  assert.match(teamAdoption, /labels:\s*\["adoption", "team-signal"\]/);
  assert.match(teamAdoption, /id:\s*theme/);
  assert.match(teamAdoption, /id:\s*scope/);
});

// Docs link to issue templates by query string (?template=name.yml). A
// previous version of docs/ADOPTION.md linked to team-adoption.yml even
// though the file did not exist, and no test caught it. Scan every
// markdown doc on the public surface for template= references and
// verify each one resolves to a real template file.
test('every ?template= link in docs and README resolves to a real template file', async () => {
  const docFiles = [
    'README.md',
    'docs/ADOPTION.md',
    'docs/PILOT.md',
    'docs/TRUST.md'
  ];

  const references = [];
  for (const relativePath of docFiles) {
    const text = await readFile(join(packageRoot, relativePath), 'utf8');
    for (const match of text.matchAll(/[?&]template=([A-Za-z0-9._-]+\.yml)/g)) {
      references.push({ doc: relativePath, template: match[1] });
    }
  }

  assert.ok(references.length > 0, 'expected docs to reference at least one issue template');

  for (const { doc, template } of references) {
    const templatePath = join(packageRoot, '.github', 'ISSUE_TEMPLATE', template);
    await assert.doesNotReject(
      access(templatePath),
      `${doc} links to ${template} but .github/ISSUE_TEMPLATE/${template} does not exist`
    );
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectClaudeSettingsDrift } from '../dist/detectors/claude-settings.js';

const testDir = dirname(fileURLToPath(import.meta.url));

test('detects Claude settings permission drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'claude-settings-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'claude-settings-drift', 'new');

  const findings = await detectClaudeSettingsDrift(oldDir, newDir);

  assert.deepEqual(
    findings.map((finding) => finding.kind),
    [
      'scope_trail.permission_allow_widened',
      'scope_trail.permission_allow_widened',
      'scope_trail.permission_deny_removed',
      'scope_trail.hook_removed'
    ]
  );
  assert.equal(findings[0].subject, 'Bash(npm *)');
  assert.equal(findings[0].line, 3);
  assert.equal(findings[1].subject, 'Read(~/**)');
  assert.equal(findings[1].line, 3);
  assert.equal(findings[2].severity, 'critical');
  assert.equal(findings[3].subject, 'PreToolUse');
});

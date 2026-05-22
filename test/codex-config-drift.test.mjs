import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectCodexConfigDrift } from '../dist/detectors/codex-config.js';

const testDir = dirname(fileURLToPath(import.meta.url));

test('detects Codex config permission drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'codex-config-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'codex-config-drift', 'new');

  const findings = await detectCodexConfigDrift(oldDir, newDir);

  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['scope_trail.codex_sandbox_widened', 'sandbox_mode', 'critical', 1],
      ['scope_trail.codex_approval_weakened', 'approval_policy', 'high', 2],
      ['scope_trail.codex_network_enabled', 'sandbox_workspace_write.network_access', 'medium', 5],
      ['scope_trail.codex_project_trusted', 'projects.trust_level', 'high', 8]
    ]
  );
});

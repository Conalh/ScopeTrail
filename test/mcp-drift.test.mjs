import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectMcpDrift } from '../dist/detectors/mcp.js';

const testDir = dirname(fileURLToPath(import.meta.url));

test('detects added MCP server with unpinned command', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.deepEqual(
    findings.map((finding) => finding.kind),
    ['mcp_server_added', 'unpinned_mcp_command']
  );
  assert.equal(findings[0].subject, 'stripe-admin');
  assert.equal(findings[1].severity, 'high');
  assert.match(findings[1].message, /@vendor\/stripe-mcp@latest/);
});

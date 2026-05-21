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
  assert.equal(findings[0].line, 7);
  assert.equal(findings[1].severity, 'high');
  assert.equal(findings[1].line, 9);
  assert.match(findings[1].message, /@vendor\/stripe-mcp@latest/);
});

test('detects MCP drift in Cursor and VS Code config files', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-multi-path', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-multi-path', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.line]),
    [
      ['.cursor/mcp.json', 'mcp_server_added', 'browser-tools', 3],
      ['.cursor/mcp.json', 'unpinned_mcp_command', 'browser-tools', 5],
      ['.vscode/mcp.json', 'mcp_server_added', 'docs-search', 3],
      ['.vscode/mcp.json', 'unpinned_mcp_command', 'docs-search', 5]
    ]
  );
});

test('detects MCP drift in Windsurf config files', async () => {
  const oldDir = join(testDir, 'fixtures', 'windsurf-mcp', 'old');
  const newDir = join(testDir, 'fixtures', 'windsurf-mcp', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.line]),
    [
      ['.codeium/windsurf/mcp_config.json', 'mcp_server_command_changed', 'team-registry', 4],
      ['.codeium/windsurf/mcp_config.json', 'mcp_server_added', 'browser-tools', 6],
      ['.codeium/windsurf/mcp_config.json', 'unpinned_mcp_command', 'browser-tools', 8]
    ]
  );
});

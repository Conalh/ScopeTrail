import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectMcpDrift, isMcpSampleConfigPath } from '../dist/detectors/mcp.js';

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

test('detects sample MCP config drift without treating it as active server drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.equal(findings.some((finding) => finding.kind === 'mcp_server_added'), false);
  assert.equal(findings.some((finding) => finding.kind === 'unpinned_mcp_command'), false);
  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['examples/.mcp.json.sample', 'mcp_sample_server_added', 'docs-search', 'low', 3],
      ['examples/.mcp.json.sample', 'mcp_sample_server_added', 'copy-risk', 'low', 7],
      ['examples/.mcp.json.sample', 'mcp_sample_unpinned_command', 'copy-risk', 'medium', 9],
      ['examples/.mcp.json.sample', 'mcp_sample_server_added', 'remote-admin', 'low', 11],
      ['examples/.mcp.json.sample', 'mcp_sample_remote_endpoint', 'remote-admin', 'medium', 12]
    ]
  );
});

test('recognizes platform-suffixed MCP examples while ignoring backup files', () => {
  assert.equal(isMcpSampleConfigPath('examples/.mcp.json.windows.example'), true);
  assert.equal(isMcpSampleConfigPath('examples/.mcp.json.example.mac'), true);
  assert.equal(isMcpSampleConfigPath('examples/.mcp.json.backup'), false);
  assert.equal(isMcpSampleConfigPath('examples/.mcp.json.bak'), false);
});

test('recognizes prefixed MCP config examples while ignoring broad registry and backup names', () => {
  assert.equal(isMcpSampleConfigPath('examples/example_mcp_config.json'), true);
  assert.equal(isMcpSampleConfigPath('examples/claude_mcp_config.json'), true);
  assert.equal(isMcpSampleConfigPath('examples/cursor_mcp_config.json'), true);
  assert.equal(isMcpSampleConfigPath('examples/vscode_mcp_config.json'), true);
  assert.equal(isMcpSampleConfigPath('examples/registry_mcp_config.json'), false);
  assert.equal(isMcpSampleConfigPath('examples/example_mcp_config.json.bak'), false);
  assert.equal(isMcpSampleConfigPath('dist/example_mcp_config.json'), false);
});

test('detects platform-suffixed MCP example drift without treating it as active server drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-platform-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-platform-sample-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.equal(findings.some((finding) => finding.kind === 'mcp_server_added'), false);
  assert.equal(findings.some((finding) => finding.kind === 'unpinned_mcp_command'), false);
  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['examples/.mcp.json.example.mac', 'mcp_sample_server_added', 'mac-docs', 'low', 3],
      ['examples/.mcp.json.example.mac', 'mcp_sample_remote_endpoint', 'mac-docs', 'medium', 4],
      ['examples/.mcp.json.windows.example', 'mcp_sample_server_added', 'win-tools', 'low', 3],
      ['examples/.mcp.json.windows.example', 'mcp_sample_unpinned_command', 'win-tools', 'medium', 7]
    ]
  );
});

test('detects prefixed MCP config example drift without treating it as active server drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-prefixed-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-prefixed-sample-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.equal(findings.some((finding) => finding.kind === 'mcp_server_added'), false);
  assert.equal(findings.some((finding) => finding.kind === 'unpinned_mcp_command'), false);
  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['examples/cursor_mcp_config.json', 'mcp_sample_server_added', 'cursor-docs', 'low', 3],
      ['examples/cursor_mcp_config.json', 'mcp_sample_remote_endpoint', 'cursor-docs', 'medium', 4],
      ['examples/example_mcp_config.json', 'mcp_sample_server_added', 'copy-risk', 'low', 3],
      ['examples/example_mcp_config.json', 'mcp_sample_unpinned_command', 'copy-risk', 'medium', 7]
    ]
  );
});

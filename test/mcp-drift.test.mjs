import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectMcpDrift, isMcpSampleConfigPath } from '../dist/detectors/mcp.js';

const testDir = dirname(fileURLToPath(import.meta.url));

test('mcp_sample_remote_endpoint: http:// fires high severity, https:// stays medium', async () => {
  // A copy-pasted sample config with an http:// endpoint silently
  // hands the user an unencrypted MCP transport. https:// is the
  // safer baseline; flag the http:// asymmetry distinctly.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-http-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, 'examples'), { recursive: true });
    mkdirSync(join(newDir, 'examples'), { recursive: true });
    writeFileSync(join(oldDir, 'examples', '.mcp.json.sample'), JSON.stringify({ mcpServers: {} }));
    writeFileSync(
      join(newDir, 'examples', '.mcp.json.sample'),
      JSON.stringify({
        mcpServers: {
          'plain-remote': { serverUrl: 'http://mcp.example.com/insecure' },
          'tls-remote': { serverUrl: 'https://mcp.example.com/safe' }
        }
      }, null, 2)
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const remoteEndpoint = findings.filter((f) => f.kind === 'scope_trail.mcp_sample_remote_endpoint');
    const bySubject = Object.fromEntries(remoteEndpoint.map((f) => [f.subject, f]));

    assert.ok(bySubject['plain-remote'], 'expected remote_endpoint finding for plain-remote');
    assert.equal(bySubject['plain-remote'].severity, 'high');
    assert.match(bySubject['plain-remote'].message, /unencrypted/);

    assert.ok(bySubject['tls-remote'], 'expected remote_endpoint finding for tls-remote');
    assert.equal(bySubject['tls-remote'].severity, 'medium');
    assert.doesNotMatch(bySubject['tls-remote'].message, /unencrypted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isUnpinnedCommand flags bunx packages without exact versions', async () => {
  // bunx is the Bun equivalent of npx and ships as a standalone
  // binary, so MCP configs use `"command": "bunx"` directly. Prior
  // to this regression test the runner list was npx/uvx/pipx only.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-bunx-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    writeFileSync(
      join(newDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'bun-helper': { command: 'bunx', args: ['@vendor/helper-mcp'] }
        }
      })
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const unpinned = findings.find((finding) => finding.kind === 'scope_trail.unpinned_mcp_command');
    assert.ok(unpinned, 'expected unpinned_mcp_command for bunx without exact version');
    assert.equal(unpinned.subject, 'bun-helper');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isUnpinnedCommand flags npm exec / yarn dlx / pnpm dlx packages without exact versions', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-npm-exec-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    writeFileSync(
      join(newDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'npm-helper': { command: 'npm', args: ['exec', '@vendor/helper-mcp'] },
          'yarn-helper': { command: 'yarn', args: ['dlx', '@vendor/helper-mcp'] },
          'pnpm-helper': { command: 'pnpm', args: ['dlx', '@vendor/helper-mcp'] }
        }
      })
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const unpinned = findings.filter((finding) => finding.kind === 'scope_trail.unpinned_mcp_command');
    const subjects = unpinned.map((f) => f.subject);

    assert.ok(subjects.includes('npm-helper'), 'expected unpinned finding for npm-helper');
    assert.ok(subjects.includes('yarn-helper'), 'expected unpinned finding for yarn-helper');
    assert.ok(subjects.includes('pnpm-helper'), 'expected unpinned finding for pnpm-helper');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('detects added MCP server with unpinned command', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.deepEqual(
    findings.map((finding) => finding.kind),
    ['scope_trail.mcp_server_added', 'scope_trail.unpinned_mcp_command']
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
      ['.cursor/mcp.json', 'scope_trail.mcp_server_added', 'browser-tools', 3],
      ['.cursor/mcp.json', 'scope_trail.unpinned_mcp_command', 'browser-tools', 5],
      ['.vscode/mcp.json', 'scope_trail.mcp_server_added', 'docs-search', 3],
      ['.vscode/mcp.json', 'scope_trail.unpinned_mcp_command', 'docs-search', 5]
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
      ['.codeium/windsurf/mcp_config.json', 'scope_trail.mcp_server_command_changed', 'team-registry', 4],
      ['.codeium/windsurf/mcp_config.json', 'scope_trail.mcp_remote_endpoint', 'team-registry', 4],
      ['.codeium/windsurf/mcp_config.json', 'scope_trail.mcp_server_added', 'browser-tools', 6],
      ['.codeium/windsurf/mcp_config.json', 'scope_trail.unpinned_mcp_command', 'browser-tools', 8]
    ]
  );
});

test('detects sample MCP config drift without treating it as active server drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.equal(findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  assert.equal(findings.some((finding) => finding.kind === 'scope_trail.unpinned_mcp_command'), false);
  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['examples/.mcp.json.sample', 'scope_trail.mcp_sample_server_added', 'docs-search', 'low', 3],
      ['examples/.mcp.json.sample', 'scope_trail.mcp_sample_server_added', 'copy-risk', 'low', 7],
      ['examples/.mcp.json.sample', 'scope_trail.mcp_sample_unpinned_command', 'copy-risk', 'medium', 9],
      ['examples/.mcp.json.sample', 'scope_trail.mcp_sample_server_added', 'remote-admin', 'low', 11],
      ['examples/.mcp.json.sample', 'scope_trail.mcp_sample_remote_endpoint', 'remote-admin', 'medium', 12]
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

  assert.equal(findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  assert.equal(findings.some((finding) => finding.kind === 'scope_trail.unpinned_mcp_command'), false);
  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['examples/.mcp.json.example.mac', 'scope_trail.mcp_sample_server_added', 'mac-docs', 'low', 3],
      ['examples/.mcp.json.example.mac', 'scope_trail.mcp_sample_remote_endpoint', 'mac-docs', 'medium', 4],
      ['examples/.mcp.json.windows.example', 'scope_trail.mcp_sample_server_added', 'win-tools', 'low', 3],
      ['examples/.mcp.json.windows.example', 'scope_trail.mcp_sample_unpinned_command', 'win-tools', 'medium', 7]
    ]
  );
});

test('detects prefixed MCP config example drift without treating it as active server drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-prefixed-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-prefixed-sample-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir);

  assert.equal(findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  assert.equal(findings.some((finding) => finding.kind === 'scope_trail.unpinned_mcp_command'), false);
  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.kind, finding.subject, finding.severity, finding.line]),
    [
      ['examples/cursor_mcp_config.json', 'scope_trail.mcp_sample_server_added', 'cursor-docs', 'low', 3],
      ['examples/cursor_mcp_config.json', 'scope_trail.mcp_sample_remote_endpoint', 'cursor-docs', 'medium', 4],
      ['examples/example_mcp_config.json', 'scope_trail.mcp_sample_server_added', 'copy-risk', 'low', 3],
      ['examples/example_mcp_config.json', 'scope_trail.mcp_sample_unpinned_command', 'copy-risk', 'medium', 7]
    ]
  );
});

test('mcp_remote_endpoint: http:// fires critical severity, https:// fires high', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-active-http-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    writeFileSync(
      join(newDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'plain-remote': { serverUrl: 'http://mcp.example.com/insecure' },
          'tls-remote': { serverUrl: 'https://mcp.example.com/safe' }
        }
      }, null, 2)
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const remoteEndpoint = findings.filter((f) => f.kind === 'scope_trail.mcp_remote_endpoint');
    const bySubject = Object.fromEntries(remoteEndpoint.map((f) => [f.subject, f]));

    assert.ok(bySubject['plain-remote'], 'expected active remote_endpoint finding for plain-remote');
    assert.equal(bySubject['plain-remote'].severity, 'critical');
    assert.match(bySubject['plain-remote'].message, /unencrypted/);

    assert.ok(bySubject['tls-remote'], 'expected active remote_endpoint finding for tls-remote');
    assert.equal(bySubject['tls-remote'].severity, 'high');
    assert.doesNotMatch(bySubject['tls-remote'].message, /unencrypted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


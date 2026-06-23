import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectMcpDrift, isMcpSampleConfigPath } from '../dist/detectors/mcp.js';

const testDir = dirname(fileURLToPath(import.meta.url));

test('mcp_config_syntax_error: malformed .mcp.json surfaces a finding instead of crashing the CLI', async () => {
  // Pre-fix gap: JSON.parse errors escaped from readJsonObjectWithSource
  // and the CLI exited 1 with a raw SyntaxError, bypassing the report
  // pipeline and fail-on semantics entirely. Now: detector returns a
  // high-severity finding and the report renders normally.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-malformed-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    // Trailing comma + unterminated object — invalid JSON.
    writeFileSync(join(newDir, '.mcp.json'), '{ "mcpServers": { "evil": { "command": "npx", "args": ["@vendor/bad@latest"], }');

    const findings = await detectMcpDrift(oldDir, newDir);
    const syntaxError = findings.find((f) => f.kind === 'scope_trail.mcp_config_syntax_error');
    assert.ok(syntaxError, 'expected mcp_config_syntax_error finding');
    assert.equal(syntaxError.severity, 'high');
    assert.equal(syntaxError.file, '.mcp.json');
    assert.match(syntaxError.message, /failed to parse/);

    // No false-positive "added" findings for the half-parsed evil server.
    const evilAdded = findings.find((f) => f.kind === 'scope_trail.mcp_server_added' && f.subject === 'evil');
    assert.equal(evilAdded, undefined, 'malformed config should not fire false mcp_server_added');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mcp_remote_endpoint: IPv6 loopback [::1] is excluded as local, not flagged as remote', async () => {
  // Node's URL parser returns IPv6 hostnames with brackets
  // (`new URL('http://[::1]:3000').hostname === '[::1]'`), so the
  // previous exclusion list of `['localhost', '127.0.0.1', '::1']`
  // never matched the bracketed form. Local IPv6 MCP endpoints
  // were getting flagged as remote.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-ipv6-'));
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
          'ipv6-local': { serverUrl: 'http://[::1]:3000/mcp' },
          'ipv4-local': { serverUrl: 'http://127.0.0.1:3000/mcp' }
        }
      })
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const remoteFindings = findings.filter((f) => f.kind === 'scope_trail.mcp_remote_endpoint');
    assert.equal(remoteFindings.length, 0, 'IPv6/IPv4 loopback should not fire remote-endpoint findings');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

    const findings = await detectMcpDrift(oldDir, newDir, { includeSamples: true });
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

test('lineForUnpinnedCommand pinpoints package line for bunx + npm exec / yarn dlx / pnpm dlx', async () => {
  // Pre-fix gap: `lineForUnpinnedCommand` only mapped npx/uvx/pipx,
  // so bunx findings (and the wrapper-runners npm/yarn/pnpm with
  // exec/dlx subcommands) fell back to the server-declaration line
  // instead of pointing at the package the reviewer needs to see.
  //
  // For wrappers we also have to skip args[0] (the subcommand) —
  // `exec` and `dlx` both pass `looksLikePackageName`, so a naive
  // scan would mis-locate to the subcommand line.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-line-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    // Hand-written JSON so we know exact line numbers — package
    // string for each server is on its own line.
    const content = [
      '{',
      '  "mcpServers": {',
      '    "bun-server": {',
      '      "command": "bunx",',
      '      "args": [',
      '        "@vendor/bun-pkg"',
      '      ]',
      '    },',
      '    "npm-server": {',
      '      "command": "npm",',
      '      "args": [',
      '        "exec",',
      '        "@vendor/npm-pkg"',
      '      ]',
      '    },',
      '    "yarn-server": {',
      '      "command": "yarn",',
      '      "args": [',
      '        "dlx",',
      '        "@vendor/yarn-pkg"',
      '      ]',
      '    }',
      '  }',
      '}',
      ''
    ].join('\n');
    writeFileSync(join(newDir, '.mcp.json'), content);

    const findings = await detectMcpDrift(oldDir, newDir);
    const unpinned = findings.filter((f) => f.kind === 'scope_trail.unpinned_mcp_command');
    const bySubject = Object.fromEntries(unpinned.map((f) => [f.subject, f]));

    assert.ok(bySubject['bun-server'], 'expected unpinned finding for bunx');
    assert.equal(bySubject['bun-server'].line, 6, 'bunx package is on line 6');

    assert.ok(bySubject['npm-server'], 'expected unpinned finding for npm exec');
    assert.equal(bySubject['npm-server'].line, 13, 'npm exec package is on line 13 (skips exec subcommand on line 12)');

    assert.ok(bySubject['yarn-server'], 'expected unpinned finding for yarn dlx');
    assert.equal(bySubject['yarn-server'].line, 20, 'yarn dlx package is on line 20 (skips dlx subcommand on line 19)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lineForUnpinnedCommand uses the matching server block when package args repeat', async () => {
  // A config can add two servers that launch the same MCP package. The
  // annotation still needs to point at the package line inside the matching
  // server, not the first identical string value in the file.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-repeat-line-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    const content = [
      '{',
      '  "mcpServers": {',
      '    "first": {',
      '      "command": "npx",',
      '      "args": ["-y", "@vendor/shared@latest"]',
      '    },',
      '    "second": {',
      '      "command": "npx",',
      '      "args": ["-y", "@vendor/shared@latest"]',
      '    }',
      '  }',
      '}',
      ''
    ].join('\n');
    writeFileSync(join(newDir, '.mcp.json'), content);

    const findings = await detectMcpDrift(oldDir, newDir);
    const unpinned = findings.filter((f) => f.kind === 'scope_trail.unpinned_mcp_command');
    const bySubject = Object.fromEntries(unpinned.map((f) => [f.subject, f]));

    assert.equal(bySubject.first.line, 5);
    assert.equal(bySubject.second.line, 9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lineForUnpinnedCommand pinpoints semver-range package specs', async () => {
  // Detection and annotation must share the same package-spec rules. Ranges
  // such as ^1.2.3 are unpinned; the finding should point at the range arg.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-range-line-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    const content = [
      '{',
      '  "mcpServers": {',
      '    "range-server": {',
      '      "command": "npx",',
      '      "args": [',
      '        "-y",',
      '        "@vendor/helper@^1.2.3"',
      '      ]',
      '    }',
      '  }',
      '}',
      ''
    ].join('\n');
    writeFileSync(join(newDir, '.mcp.json'), content);

    const findings = await detectMcpDrift(oldDir, newDir);
    const unpinned = findings.find((f) => f.kind === 'scope_trail.unpinned_mcp_command');

    assert.ok(unpinned, 'expected unpinned_mcp_command for semver range');
    assert.equal(unpinned.line, 7);
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


test('isUnpinnedCommand flags semver-range package specs (^, ~, >=, *)', async () => {
  // Pre-fix gap: looksLikePackageName's char class accepted only
  // [a-z0-9._/@-], so `@vendor/helper@^1.2.3`, `~1.2.3`, and the
  // less-common `mcp-server>=1.2.3` form fell out of the package-shape
  // check entirely — producing medium command-change findings instead
  // of high unpinned findings.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-ranges-'));
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
          'caret-range': { command: 'npx', args: ['-y', '@vendor/helper@^1.2.3'] },
          'tilde-range': { command: 'npx', args: ['-y', '@vendor/helper@~1.2.3'] },
          'gte-range':   { command: 'npx', args: ['-y', '@vendor/helper@>=1.2.3'] },
          'star-range':  { command: 'npx', args: ['-y', '@vendor/helper@*'] },
          'bare-name':   { command: 'npx', args: ['-y', '@vendor/helper'] },
          'compare-form':{ command: 'npx', args: ['mcp-server>=1.2.3'] },
          'exact-pin':   { command: 'npx', args: ['-y', '@vendor/helper@1.2.3'] }
        }
      })
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const unpinned = findings.filter((f) => f.kind === 'scope_trail.unpinned_mcp_command');
    const subjects = new Set(unpinned.map((f) => f.subject));

    for (const name of ['caret-range', 'tilde-range', 'gte-range', 'star-range', 'bare-name', 'compare-form']) {
      assert.ok(subjects.has(name), `expected unpinned finding for ${name}`);
    }
    assert.equal(subjects.has('exact-pin'), false, 'exact pin should not be flagged unpinned');
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

test('merges all recognized server maps — an empty mcpServers must not shadow a populated servers', async () => {
  // Pre-fix gap: readServerMap returned the FIRST recognized key only.
  // For .cursor/mcp.json (serverKeys: mcpServers, servers) an empty
  // `mcpServers: {}` shadowed a populated `servers: {}`, so every server
  // declared under `servers` was invisible to the diff.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-merge-maps-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, '.cursor'), { recursive: true });
    mkdirSync(join(newDir, '.cursor'), { recursive: true });
    writeFileSync(join(oldDir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {}, servers: {} }));
    writeFileSync(
      join(newDir, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {},
        servers: {
          'new-risky-server': { command: 'npx', args: ['@bad/server@latest'] }
        }
      }, null, 2)
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    assert.ok(
      findings.some((f) => f.kind === 'scope_trail.mcp_server_added' && f.subject === 'new-risky-server'),
      'server under `servers` must be detected even when an empty `mcpServers` exists'
    );
    assert.ok(
      findings.some((f) => f.kind === 'scope_trail.unpinned_mcp_command' && f.subject === 'new-risky-server'),
      'unpinned command under `servers` must also be flagged'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('sample MCP configs are not reviewed unless includeSamples is set (opt-in)', async () => {
  // The Signal that drove this gate: a `.mcp.json.sample` / `.template` never
  // loads into an agent runtime, so a change to one cannot widen what the agent
  // is allowed to do. For a *drift* detector that makes it noise, not drift —
  // the default report must stay silent on samples. Review is opt-in.
  const oldDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'new');

  const defaultFindings = await detectMcpDrift(oldDir, newDir);
  assert.deepEqual(defaultFindings, [], 'sample configs must produce no findings by default');

  // The opt-in re-enables the same fixture's sample findings — gated, not gone.
  const optedIn = await detectMcpDrift(oldDir, newDir, { includeSamples: true });
  assert.ok(
    optedIn.some((finding) => finding.kind === 'scope_trail.mcp_sample_server_added'),
    'includeSamples must re-enable sample review'
  );
});

test('detects sample MCP config drift without treating it as active server drift', async () => {
  const oldDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'mcp-sample-drift', 'new');

  const findings = await detectMcpDrift(oldDir, newDir, { includeSamples: true });

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

  const findings = await detectMcpDrift(oldDir, newDir, { includeSamples: true });

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

  const findings = await detectMcpDrift(oldDir, newDir, { includeSamples: true });

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

test('mcp_server_sensitive_field_changed: an existing server gaining env/headers/cwd is flagged; removals are not', async () => {
  // serverCommand() ignores env/headers/cwd, so a server keeping the same
  // launch command but gaining a secret env var, an auth header, or a
  // redirected cwd produced no finding. Now flagged — secret-bearing keys
  // escalate to high. Removing a key is a narrowing and stays silent.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-sensitive-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(
      join(oldDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          stripe: { command: 'npx', args: ['-y', '@vendor/stripe-mcp@1.2.3'], env: { LOG_LEVEL: 'info' } },
          docs: { command: 'npx', args: ['-y', '@vendor/docs@1.0.0'] }
        }
      })
    );
    writeFileSync(
      join(newDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          // Same command: gains a secret env var + a benign one; LOG_LEVEL removed.
          stripe: { command: 'npx', args: ['-y', '@vendor/stripe-mcp@1.2.3'], env: { STRIPE_SECRET_KEY: '${STRIPE_SECRET_KEY}', REGION: 'us' } },
          // Same command: gains an Authorization header and a redirected cwd.
          docs: { command: 'npx', args: ['-y', '@vendor/docs@1.0.0'], headers: { Authorization: 'Bearer x' }, cwd: '/etc' }
        }
      }, null, 2)
    );

    const findings = await detectMcpDrift(oldDir, newDir);
    const sensitive = findings.filter((f) => f.kind === 'scope_trail.mcp_server_sensitive_field_changed');

    const stripeEnv = sensitive.find((f) => f.subject === 'stripe' && /environment variable/.test(f.message));
    assert.ok(stripeEnv, 'expected env change finding for stripe');
    assert.equal(stripeEnv.severity, 'high', 'STRIPE_SECRET_KEY is secret-like -> high');
    assert.match(stripeEnv.message, /STRIPE_SECRET_KEY/);
    assert.doesNotMatch(stripeEnv.message, /LOG_LEVEL/, 'a removed env var must not be reported');

    const docsHeader = sensitive.find((f) => f.subject === 'docs' && /header/.test(f.message));
    assert.ok(docsHeader, 'expected header change finding for docs');
    assert.equal(docsHeader.severity, 'high', 'Authorization header is secret-like -> high');

    const docsCwd = sensitive.find((f) => f.subject === 'docs' && /working directory/.test(f.message));
    assert.ok(docsCwd, 'expected cwd change finding for docs');
    assert.equal(docsCwd.severity, 'medium');

    // No added/command-changed noise — both servers existed and kept their command.
    assert.equal(findings.some((f) => f.kind === 'scope_trail.mcp_server_added'), false);
    assert.equal(findings.some((f) => f.kind === 'scope_trail.mcp_server_command_changed'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

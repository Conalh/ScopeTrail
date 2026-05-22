import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectCodexConfigDrift } from '../dist/detectors/codex-config.js';

const testDir = dirname(fileURLToPath(import.meta.url));

// The detector previously only saw scalar settings (sandbox, approval,
// network, project trust) — `[mcp_servers.NAME]` sections in
// .codex/config.toml were invisible. Three new findings cover that:
// codex_mcp_server_added (high), codex_mcp_server_command_changed
// (medium), and codex_unpinned_mcp_command (high).
test('detects Codex TOML MCP server additions and unpinned commands', async () => {
  const oldDir = join(testDir, 'fixtures', 'codex-mcp-drift', 'old');
  const newDir = join(testDir, 'fixtures', 'codex-mcp-drift', 'new');

  const findings = await detectCodexConfigDrift(oldDir, newDir);

  const kinds = findings.map((finding) => [finding.kind, finding.subject]);
  assert.deepEqual(kinds, [
    ['scope_trail.codex_mcp_server_added', 'stripe-admin'],
    ['scope_trail.codex_unpinned_mcp_command', 'stripe-admin'],
    ['scope_trail.codex_mcp_server_added', 'bootstrap'],
    ['scope_trail.codex_unpinned_mcp_command', 'bootstrap']
  ]);

  // The pinned helper was already there and unchanged — no findings.
  assert.equal(findings.filter((finding) => finding.subject === 'pinned-helper').length, 0);

  // Stripe-admin is unpinned via @latest; bootstrap is curl-pipe-sh.
  const stripeUnpinned = findings.find(
    (finding) => finding.kind === 'scope_trail.codex_unpinned_mcp_command' && finding.subject === 'stripe-admin'
  );
  assert.ok(stripeUnpinned);
  assert.match(stripeUnpinned.message, /@latest/);

  const bootstrapUnpinned = findings.find(
    (finding) => finding.kind === 'scope_trail.codex_unpinned_mcp_command' && finding.subject === 'bootstrap'
  );
  assert.ok(bootstrapUnpinned);
  assert.match(bootstrapUnpinned.message, /curl/);

  // Findings should be locatable — line numbers should point at lines
  // inside the [mcp_servers.NAME] table, not at file-level.
  for (const finding of findings) {
    assert.ok(typeof finding.line === 'number' && finding.line > 0, `expected line for ${finding.kind} ${finding.subject}`);
  }
});

test('codex_mcp_server_command_changed fires when an existing server changes its launch command', async () => {
  // Use temporary directories via in-memory fixtures so we can flip
  // just the command on a server that already exists. The fixture
  // pair above tests the *added* path; this one tests the *changed*
  // path without proliferating fixture files.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-codex-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, '.codex'), { recursive: true });
    mkdirSync(join(newDir, '.codex'), { recursive: true });

    writeFileSync(
      join(oldDir, '.codex', 'config.toml'),
      '[mcp_servers.helper]\ncommand = "npx"\nargs = ["-y", "@vendor/helper-mcp@1.2.3"]\n'
    );
    writeFileSync(
      join(newDir, '.codex', 'config.toml'),
      '[mcp_servers.helper]\ncommand = "npx"\nargs = ["-y", "@vendor/helper-mcp@2.0.0"]\n'
    );

    const findings = await detectCodexConfigDrift(oldDir, newDir);
    assert.deepEqual(
      findings.map((finding) => [finding.kind, finding.subject]),
      [['scope_trail.codex_mcp_server_command_changed', 'helper']]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

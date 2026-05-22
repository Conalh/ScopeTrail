import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectCodexConfigDrift } from '../dist/detectors/codex-config.js';

const testDir = dirname(fileURLToPath(import.meta.url));

test('codex_config_syntax_error: malformed TOML surfaces a finding instead of returning a clean report', async () => {
  // Pre-fix gap: `parseToml` failure was silently swallowed, so a
  // malformed .codex/config.toml that contained risky settings still
  // produced rating: "none" / findingCount: 0. Worse than failing
  // loudly because advisory output looks clean.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(testDir, '..', 'node_modules', '.scopetrail-codex-malformed-')
    .replaceAll('\\', '/'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, '.codex'), { recursive: true });
    mkdirSync(join(newDir, '.codex'), { recursive: true });
    writeFileSync(join(oldDir, '.codex', 'config.toml'), 'sandbox_mode = "workspace-write"\n');
    // Unterminated quoted string makes the parser fail.
    writeFileSync(
      join(newDir, '.codex', 'config.toml'),
      'sandbox_mode = "danger-full-access\n[mcp_servers.evil]\nargs = ["@vendor/bad@latest"]\n'
    );

    const findings = await detectCodexConfigDrift(oldDir, newDir);
    assert.equal(findings.length, 1, 'malformed TOML should produce exactly one syntax_error finding');
    assert.equal(findings[0].kind, 'scope_trail.codex_config_syntax_error');
    assert.equal(findings[0].severity, 'high');
    assert.match(findings[0].message, /failed to parse/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex_project_trusted: each [projects.<path>] is tracked independently', async () => {
  // Pre-fix gap: `normalizeSection` collapsed every `[projects.*]`
  // section to `projects`, then `normalizeKey` produced
  // `projects.trust_level` for any project — Map keys overwrote
  // each other, so adding a second trusted project went undetected
  // when a first trusted project already existed.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(testDir, '..', 'node_modules', '.scopetrail-codex-projects-')
    .replaceAll('\\', '/'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, '.codex'), { recursive: true });
    mkdirSync(join(newDir, '.codex'), { recursive: true });
    writeFileSync(
      join(oldDir, '.codex', 'config.toml'),
      "[projects.'/home/dev/alpha']\ntrust_level = \"trusted\"\n"
    );
    // New file: alpha still trusted, beta and gamma now also trusted.
    writeFileSync(
      join(newDir, '.codex', 'config.toml'),
      "[projects.'/home/dev/alpha']\ntrust_level = \"trusted\"\n\n" +
      "[projects.'/home/dev/beta']\ntrust_level = \"trusted\"\n\n" +
      "[projects.'/home/dev/gamma']\ntrust_level = \"trusted\"\n"
    );

    const findings = await detectCodexConfigDrift(oldDir, newDir);
    const trustedFindings = findings.filter((f) => f.kind === 'scope_trail.codex_project_trusted');
    const subjects = trustedFindings.map((f) => f.subject).sort();

    assert.equal(trustedFindings.length, 2, 'expected exactly two new trusted-project findings');
    assert.deepEqual(subjects, [
      'projects./home/dev/beta.trust_level',
      'projects./home/dev/gamma.trust_level'
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
      ['scope_trail.codex_project_trusted', 'projects.c:\\dev\\example.trust_level', 'high', 8]
    ]
  );
});

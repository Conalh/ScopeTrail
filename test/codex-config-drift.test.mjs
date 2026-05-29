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

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-codex-malformed-'));
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

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-codex-projects-'));
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

test('inline-table sandbox/network keys are detected (parsed TOML, not regex)', async () => {
  // Pre-fix gap: parseTomlEntries used a line-regex that bailed on
  // values starting with `{`, so `sandbox_workspace_write = { network_access = true }`
  // and `windows = { sandbox = "danger-full-access" }` returned
  // rating: "none" / findingCount: 0 even though they're valid TOML
  // that widens the Codex sandbox or enables network access.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-codex-inline-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, '.codex'), { recursive: true });
    mkdirSync(join(newDir, '.codex'), { recursive: true });
    writeFileSync(
      join(oldDir, '.codex', 'config.toml'),
      'sandbox_mode = "workspace-write"\napproval_policy = "on-request"\n'
    );
    writeFileSync(
      join(newDir, '.codex', 'config.toml'),
      'sandbox_workspace_write = { network_access = true }\n' +
      'windows = { sandbox = "danger-full-access" }\n' +
      'approval_policy = "never"\n'
    );

    const findings = await detectCodexConfigDrift(oldDir, newDir);
    const byKind = (kind) => findings.filter((f) => f.kind === kind);

    const sandboxFindings = byKind('scope_trail.codex_sandbox_widened');
    assert.ok(
      sandboxFindings.some((f) => f.subject === 'windows.sandbox'),
      'expected windows.sandbox inline-table widening to be detected'
    );

    const networkFindings = byKind('scope_trail.codex_network_enabled');
    assert.ok(
      networkFindings.some((f) => f.subject === 'sandbox_workspace_write.network_access'),
      'expected inline-table sandbox_workspace_write.network_access to be detected'
    );

    const approvalFindings = byKind('scope_trail.codex_approval_weakened');
    assert.equal(approvalFindings.length, 1, 'approval_policy regression check');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex baseline: a brand-new config at the narrowest posture is not flagged as widening', async () => {
  // Pre-fix gap: a missing base value ranked at -1, so adding a fresh
  // .codex/config.toml whose sandbox/approval were the *narrowest*
  // settings (read-only sandbox, untrusted approval) reported them as
  // widened/weakened — a high-severity false positive on the safest
  // possible config. The baseline now anchors at Codex's safe default.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-codex-baseline-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    // No .codex/config.toml in the base at all.
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(join(newDir, '.codex'), { recursive: true });
    writeFileSync(
      join(newDir, '.codex', 'config.toml'),
      'sandbox_mode = "read-only"\napproval_policy = "untrusted"\n'
    );

    const findings = await detectCodexConfigDrift(oldDir, newDir);
    assert.deepEqual(findings, [], 'narrowest settings in a brand-new config must not flag');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex baseline: a brand-new config that introduces a wide posture is still flagged', async () => {
  // The baseline anchor must not over-suppress: introducing a
  // danger-full-access sandbox or `never` approval where the base had no
  // .codex/config.toml is a genuine permission event, not a false positive.
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'scopetrail-codex-baseline-wide-'));
  try {
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(join(newDir, '.codex'), { recursive: true });
    writeFileSync(
      join(newDir, '.codex', 'config.toml'),
      'sandbox_mode = "danger-full-access"\napproval_policy = "never"\n'
    );

    const findings = await detectCodexConfigDrift(oldDir, newDir);
    const byKind = (kind) => findings.find((f) => f.kind === kind);

    const sandbox = byKind('scope_trail.codex_sandbox_widened');
    assert.ok(sandbox, 'full-access sandbox introduced from no baseline must still flag');
    assert.equal(sandbox.severity, 'critical');
    assert.ok(
      byKind('scope_trail.codex_approval_weakened'),
      'never approval introduced from no baseline must still flag'
    );
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

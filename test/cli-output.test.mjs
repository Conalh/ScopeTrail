import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

test('CLI emits JSON permission drift report', async () => {
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');

  const { stdout } = await execFileAsync(
    process.execPath,
    ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'json'],
    { cwd: packageRoot }
  );
  const report = JSON.parse(stdout);

  assert.equal(report.rating, 'critical');
  assert.equal(report.findings.length, 6);
  assert.deepEqual(
    report.findings.map((finding) => finding.kind),
    [
      'mcp_server_added',
      'unpinned_mcp_command',
      'permission_allow_widened',
      'permission_allow_widened',
      'permission_deny_removed',
      'hook_removed'
    ]
  );
});

test('CLI emits Markdown permission drift report', async () => {
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');

  const { stdout } = await execFileAsync(
    process.execPath,
    ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'markdown'],
    { cwd: packageRoot }
  );

  assert.match(stdout, /# ScopeTrail permission drift: CRITICAL/);
  assert.match(stdout, /stripe-admin/);
  assert.match(stdout, /Bash\(npm \*\)/);
  assert.match(stdout, /PreToolUse/);
});

test('CLI emits GitHub warning annotations for permission drift findings', async () => {
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');

  const { stdout } = await execFileAsync(
    process.execPath,
    ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'github'],
    { cwd: packageRoot }
  );

  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^::warning file=.mcp.json,line=7,title=ScopeTrail high permission drift::/);
  assert.match(stdout, /file=.mcp.json,line=9,title=ScopeTrail high permission drift/);
  assert.match(stdout, /file=.claude\/settings.json,line=3,title=ScopeTrail high permission drift/);
  assert.match(stdout, /stripe-admin/);
  assert.match(stdout, /Bash\(npm \*\)/);
  assert.match(stdout, /Read\(.env\)/);
  assert.doesNotMatch(stdout, /::error/);
});

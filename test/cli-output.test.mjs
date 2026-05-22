import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
      'scope_trail.mcp_server_added',
      'scope_trail.unpinned_mcp_command',
      'scope_trail.permission_allow_widened',
      'scope_trail.permission_allow_widened',
      'scope_trail.permission_deny_removed',
      'scope_trail.hook_removed'
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
  assert.match(stdout, /## Feedback/);
  assert.match(stdout, /issues\/new\/choose/);
  assert.match(stdout, /false positives or missing config surfaces/i);
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

test('CLI renders markdown and JSON to files alongside stdout annotations in a single scan', async () => {
  // The GitHub Action used to invoke the CLI three times (one per
  // format), repeating snapshot materialization and detector work on
  // each call. `--out-markdown PATH` and `--out-json PATH` let the
  // Action render every output it needs from one scan.
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');
  const outDir = await mkdtemp(join(tmpdir(), 'scopetrail-out-'));
  const mdPath = join(outDir, 'report.md');
  const jsonPath = join(outDir, 'report.json');

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        'dist/index.js', 'diff',
        '--old', oldDir, '--new', newDir,
        '--format', 'github',
        '--out-markdown', mdPath,
        '--out-json', jsonPath
      ],
      { cwd: packageRoot }
    );

    // stdout still carries the GitHub annotation format the Actions
    // runner expects, identical to the single `--format github` run.
    assert.match(stdout, /^::warning file=.mcp.json/);
    assert.doesNotMatch(stdout, /^# ScopeTrail/m);

    // Markdown file matches what `--format markdown` would have
    // written to stdout — same render, just routed to disk.
    const markdown = await readFile(mdPath, 'utf8');
    assert.match(markdown, /# ScopeTrail permission drift: CRITICAL/);
    assert.match(markdown, /stripe-admin/);

    // JSON file is parseable and matches the legacy `--format json`
    // structure callers rely on for rating + finding-count outputs.
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(parsed.rating, 'critical');
    assert.equal(parsed.findings.length, 6);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

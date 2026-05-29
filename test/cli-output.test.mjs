import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('Markdown render escapes config-controlled strings against injection', async () => {
  // Config-derived strings (server names, permission patterns) flow into
  // the markdown report. Without escaping, a hostile config could inject
  // links, images, raw HTML, or emphasis runs into the PR comment.
  // Subjects are wrapped in backtick code spans; messages have inline
  // markdown chars escaped.
  const workDir = await mkdtemp(join(tmpdir(), 'scopetrail-md-inject-'));
  try {
    const oldDir = join(workDir, 'old');
    const newDir = join(workDir, 'new');
    await mkdir(oldDir, { recursive: true });
    await mkdir(newDir, { recursive: true });
    // Empty base config so the hostile entries below register as
    // additions / widenings.
    await writeFile(join(oldDir, '.mcp.json'), '{"mcpServers": {}}\n');
    await writeFile(
      join(oldDir, '.claude', 'settings.json'),
      '{"permissions": {"allow": [], "deny": []}}\n'
    ).catch(async () => {
      await mkdir(join(oldDir, '.claude'), { recursive: true });
      await writeFile(
        join(oldDir, '.claude', 'settings.json'),
        '{"permissions": {"allow": [], "deny": []}}\n'
      );
    });

    // A server name that tries to inject a markdown link and an image,
    // and a permission entry that includes backticks + emphasis.
    const hostileServerName = 'evil](https://attacker.example)<img src=x>';
    await writeFile(
      join(newDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          [hostileServerName]: {
            command: 'npx',
            args: ['-y', '@vendor/pkg@latest']
          }
        }
      }, null, 2) + '\n'
    );
    await mkdir(join(newDir, '.claude'), { recursive: true });
    await writeFile(
      join(newDir, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash'], deny: [] }
      }, null, 2) + '\n'
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'markdown'],
      { cwd: packageRoot }
    );

    // Strip backtick code spans before checking — chars inside a code
    // span are inert (markdown renders them as literal code), so the
    // security property only applies to the prose outside spans.
    const outsideCodeSpans = stdout.replace(/`[^`]*`/g, '');
    // Outside code spans, every `](` must be backslash-escaped —
    // otherwise it forms a markdown link. Same for `<img` (raw HTML)
    // and `[text]` (image/link openers).
    assert.doesNotMatch(outsideCodeSpans, /(?<!\\)\]\(/);
    assert.doesNotMatch(outsideCodeSpans, /(?<!\\)<img/);
    // Message body contains the escaped versions explicitly. We
    // escape `]` (which disarms the `[text](url)` link form by
    // breaking the closing bracket) and the angle brackets that
    // would otherwise open raw HTML. Parentheses stay literal —
    // a markdown link needs an unescaped `]` AND `(`, so escaping
    // either one is sufficient.
    assert.match(stdout, /\\\]\(https:\/\/attacker\.example\)/);
    assert.match(stdout, /\\<img src=x\\>/);
    // Subjects are wrapped in backtick code spans so the raw hostile
    // string renders as code rather than as markdown syntax.
    assert.match(stdout, /`evil\]\(https:\/\/attacker\.example\)<img src=x>`/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('CLI emits severity-aware GitHub annotations for permission drift findings', async () => {
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');

  const { stdout } = await execFileAsync(
    process.execPath,
    ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'github'],
    { cwd: packageRoot }
  );

  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 6);
  // high/critical findings escalate to ::error to match agent-gov-core's
  // annotation contract; medium/low stay ::warning.
  assert.match(lines[0], /^::error file=.mcp.json,line=7,title=ScopeTrail high permission drift::/);
  assert.match(stdout, /::error file=.mcp.json,line=9,title=ScopeTrail high permission drift/);
  assert.match(stdout, /::error file=.claude\/settings.json,line=3,title=ScopeTrail high permission drift/);
  assert.match(stdout, /::error file=.claude\/settings.json,title=ScopeTrail critical permission drift/);
  assert.match(stdout, /::warning file=.claude\/settings.json,line=3,title=ScopeTrail medium permission drift/);
  assert.match(stdout, /stripe-admin/);
  assert.match(stdout, /Bash\(npm \*\)/);
  assert.match(stdout, /Read\(.env\)/);
});

test('CLI --fail-on exits 1 when rating meets the threshold (and 0 below it)', async () => {
  // Threshold logic used to live only in action.yml, so local/other-CI
  // users had to grep the JSON report. The CLI now mirrors the Action.
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');

  // Below threshold: rating "critical" with --fail-on critical+1 doesn't
  // exist, so test the "above threshold" case at high.
  let aboveStatus = 0;
  try {
    await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'json', '--fail-on', 'high'],
      { cwd: packageRoot }
    );
  } catch (error) {
    aboveStatus = error.code ?? 0;
  }
  assert.equal(aboveStatus, 1, 'rating critical >= threshold high should exit 1');

  // Below: same diff, but --fail-on none should still exit 0.
  const { stdout: belowStdout } = await execFileAsync(
    process.execPath,
    ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'json', '--fail-on', 'none'],
    { cwd: packageRoot }
  );
  assert.equal(JSON.parse(belowStdout).rating, 'critical');
});

test('CLI --fail-on rejects unknown values with exit 2', async () => {
  const oldDir = join(testDir, 'fixtures', 'combined', 'old');
  const newDir = join(testDir, 'fixtures', 'combined', 'new');

  let status = 0;
  let stderr = '';
  try {
    await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--fail-on', 'severe'],
      { cwd: packageRoot }
    );
  } catch (error) {
    status = error.code ?? 0;
    stderr = error.stderr ?? '';
  }
  assert.equal(status, 2);
  assert.match(stderr, /Invalid --fail-on value/);
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
    assert.match(stdout, /^::error file=.mcp.json/);
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

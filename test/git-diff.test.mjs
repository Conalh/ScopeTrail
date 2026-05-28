import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { makeGitRepo } from 'agent-gov-core/test-utils';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

async function runDiff(repo, base, head) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['dist/index.js', 'diff', '--repo', repo, '--base', base, '--head', head, '--format', 'json'],
    { cwd: packageRoot }
  );
  return JSON.parse(stdout);
}

function configFiles({ mcp, claude }) {
  return {
    '.mcp.json': `${JSON.stringify(mcp, null, 2)}\n`,
    '.claude/settings.json': `${JSON.stringify(claude, null, 2)}\n`,
  };
}

test('CLI diffs permission drift between git refs', async () => {
  const fx = await makeGitRepo({
    prefix: 'scopetrail-git-',
    initialFiles: configFiles({
      mcp: {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github@1.2.3']
          }
        }
      },
      claude: {
        permissions: {
          allow: ['Bash(npm test)', 'Read(src/**)'],
          deny: ['Read(.env)', 'Read(**/*.pem)']
        },
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/hooks/bash-guard.ps1' }] }]
        }
      }
    }),
    initialMessage: 'base agent config',
  });
  try {
    const base = await fx.head();
    const head = await fx.commit(
      configFiles({
        mcp: {
          mcpServers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github@1.2.3']
            },
            'stripe-admin': {
              command: 'npx',
              args: ['-y', '@vendor/stripe-mcp@latest']
            }
          }
        },
        claude: {
          permissions: {
            allow: ['Bash(npm *)', 'Read(~/**)'],
            deny: ['Read(**/*.pem)']
          },
          hooks: {}
        }
      }),
      'widen agent config'
    );

    const report = await runDiff(fx.repo, base, head);

    assert.equal(report.rating, 'critical');
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
  } finally {
    await fx.cleanup();
  }
});

test('CLI git diff snapshots sample MCP config paths', async () => {
  const fx = await makeGitRepo({
    prefix: 'scopetrail-git-sample-',
    initialFiles: { 'README.md': 'base\n' },
    initialMessage: 'base',
  });
  try {
    const base = await fx.head();
    const head = await fx.commit(
      {
        'examples/.mcp.json.sample': `${JSON.stringify(
          {
            mcpServers: {
              'copy-risk': {
                command: 'npx',
                args: ['-y', '@acme/copy-risk@latest']
              }
            }
          },
          null,
          2
        )}\n`,
      },
      'add sample mcp config'
    );

    const report = await runDiff(fx.repo, base, head);

    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ['scope_trail.mcp_sample_server_added', 'scope_trail.mcp_sample_unpinned_command']
    );
    assert.equal(report.findings[0].location.file, 'examples/.mcp.json.sample');
    assert.equal(report.findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  } finally {
    await fx.cleanup();
  }
});

test('CLI git diff snapshots platform-suffixed MCP example paths', async () => {
  const fx = await makeGitRepo({
    prefix: 'scopetrail-git-platform-sample-',
    initialFiles: { 'README.md': 'base\n' },
    initialMessage: 'base',
  });
  try {
    const base = await fx.head();
    const head = await fx.commit(
      {
        'examples/.mcp.json.windows.example': `${JSON.stringify(
          {
            mcpServers: {
              'copy-risk': {
                command: 'npx',
                args: ['-y', '@acme/copy-risk@latest']
              }
            }
          },
          null,
          2
        )}\n`,
      },
      'add platform sample mcp config'
    );

    const report = await runDiff(fx.repo, base, head);

    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ['scope_trail.mcp_sample_server_added', 'scope_trail.mcp_sample_unpinned_command']
    );
    assert.equal(report.findings[0].location.file, 'examples/.mcp.json.windows.example');
    assert.equal(report.findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  } finally {
    await fx.cleanup();
  }
});

test('CLI surfaces a friendly error when a git ref cannot be resolved', async () => {
  // Pre-fix gap: rev-parse failures escaped as a raw Node child_process
  // stack trace. The most common cause in CI is a shallow checkout that
  // doesn't include the PR base ref, so the message now mentions
  // fetch-depth: 0 explicitly.
  const fx = await makeGitRepo({
    prefix: 'scopetrail-git-bad-ref-',
    initialFiles: { 'README.md': 'base\n' },
    initialMessage: 'base',
  });
  try {
    let stderr = '';
    let exitCode = 0;
    try {
      await execFileAsync(
        process.execPath,
        ['dist/index.js', 'diff', '--repo', fx.repo, '--base', 'does-not-exist', '--head', 'HEAD', '--format', 'json'],
        { cwd: packageRoot }
      );
    } catch (error) {
      stderr = error.stderr ?? '';
      exitCode = error.code ?? 0;
    }

    assert.equal(exitCode, 2, 'expected exit code 2 for unresolvable ref');
    assert.match(stderr, /does-not-exist/, 'error should name the ref');
    assert.match(stderr, /fetch-depth: 0/, 'error should hint at fetch-depth: 0');
    assert.doesNotMatch(stderr, /\bat \w+ \(/, 'error should not leak a Node stack trace');
  } finally {
    await fx.cleanup();
  }
});

test('CLI rejects git refs that could be parsed as git CLI flags', async () => {
  // Hardening: `execFile` blocks shell injection, but `git` re-parses
  // each positional arg against its own option table. A ref like
  // `--upload-pack=...` or `--help` would otherwise be consumed by
  // git as a flag rather than a revision. We surface a clean error
  // before invoking git so the injection vector is closed.
  const fx = await makeGitRepo({
    prefix: 'scopetrail-git-bad-ref-flag-',
    initialFiles: { 'README.md': 'base\n' },
    initialMessage: 'base',
  });
  try {
    // Note: bare `--help` / `-h` are intercepted by the top-level CLI
    // parser before reaching ref validation, so they're omitted here.
    // The remaining patterns are the real argument-injection vectors.
    for (const bad of ['-rf', '--upload-pack=evil', '--exec=evil', 'main:evil']) {
      let stderr = '';
      let exitCode = 0;
      try {
        await execFileAsync(
          process.execPath,
          ['dist/index.js', 'diff', '--repo', fx.repo, '--base', bad, '--head', 'HEAD', '--format', 'json'],
          { cwd: packageRoot }
        );
      } catch (error) {
        stderr = error.stderr ?? '';
        exitCode = error.code ?? 0;
      }

      assert.equal(exitCode, 2, `expected exit code 2 for rejected ref ${bad}`);
      assert.match(stderr, /Invalid git ref/, `error should reject ref ${bad}`);
    }
  } finally {
    await fx.cleanup();
  }
});

test('CLI git diff snapshots prefixed MCP config example paths', async () => {
  const fx = await makeGitRepo({
    prefix: 'scopetrail-git-prefixed-sample-',
    initialFiles: { 'README.md': 'base\n' },
    initialMessage: 'base',
  });
  try {
    const base = await fx.head();
    const head = await fx.commit(
      {
        'examples/example_mcp_config.json': `${JSON.stringify(
          {
            mcpServers: {
              'copy-risk': {
                command: 'npx',
                args: ['-y', '@acme/copy-risk@latest']
              }
            }
          },
          null,
          2
        )}\n`,
      },
      'add prefixed sample mcp config'
    );

    const report = await runDiff(fx.repo, base, head);

    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ['scope_trail.mcp_sample_server_added', 'scope_trail.mcp_sample_unpinned_command']
    );
    assert.equal(report.findings[0].location.file, 'examples/example_mcp_config.json');
    assert.equal(report.findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  } finally {
    await fx.cleanup();
  }
});

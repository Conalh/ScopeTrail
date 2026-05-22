import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

test('CLI diffs permission drift between git refs', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scopetrail-git-'));
  try {
    await execGit(repo, 'init', '-b', 'main');
    await execGit(repo, 'config', 'user.name', 'ScopeTrail Test');
    await execGit(repo, 'config', 'user.email', 'scopetrail@example.invalid');

    await writeConfig(repo, {
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
    });
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'base agent config');
    const base = await gitStdout(repo, 'rev-parse', 'HEAD');

    await writeConfig(repo, {
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
    });
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'widen agent config');
    const head = await gitStdout(repo, 'rev-parse', 'HEAD');

    const { stdout } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--repo', repo, '--base', base, '--head', head, '--format', 'json'],
      { cwd: packageRoot }
    );
    const report = JSON.parse(stdout);

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
    await rm(repo, { recursive: true, force: true });
  }
});

test('CLI git diff snapshots sample MCP config paths', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scopetrail-git-sample-'));
  try {
    await execGit(repo, 'init', '-b', 'main');
    await execGit(repo, 'config', 'user.name', 'ScopeTrail Test');
    await execGit(repo, 'config', 'user.email', 'scopetrail@example.invalid');

    await writeFile(join(repo, 'README.md'), 'base\n');
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'base');
    const base = await gitStdout(repo, 'rev-parse', 'HEAD');

    await mkdir(join(repo, 'examples'), { recursive: true });
    await writeFile(
      join(repo, 'examples', '.mcp.json.sample'),
      `${JSON.stringify(
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
      )}\n`
    );
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'add sample mcp config');
    const head = await gitStdout(repo, 'rev-parse', 'HEAD');

    const { stdout } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--repo', repo, '--base', base, '--head', head, '--format', 'json'],
      { cwd: packageRoot }
    );
    const report = JSON.parse(stdout);

    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ['scope_trail.mcp_sample_server_added', 'scope_trail.mcp_sample_unpinned_command']
    );
    assert.equal(report.findings[0].file, 'examples/.mcp.json.sample');
    assert.equal(report.findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('CLI git diff snapshots platform-suffixed MCP example paths', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scopetrail-git-platform-sample-'));
  try {
    await execGit(repo, 'init', '-b', 'main');
    await execGit(repo, 'config', 'user.name', 'ScopeTrail Test');
    await execGit(repo, 'config', 'user.email', 'scopetrail@example.invalid');

    await writeFile(join(repo, 'README.md'), 'base\n');
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'base');
    const base = await gitStdout(repo, 'rev-parse', 'HEAD');

    await mkdir(join(repo, 'examples'), { recursive: true });
    await writeFile(
      join(repo, 'examples', '.mcp.json.windows.example'),
      `${JSON.stringify(
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
      )}\n`
    );
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'add platform sample mcp config');
    const head = await gitStdout(repo, 'rev-parse', 'HEAD');

    const { stdout } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--repo', repo, '--base', base, '--head', head, '--format', 'json'],
      { cwd: packageRoot }
    );
    const report = JSON.parse(stdout);

    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ['scope_trail.mcp_sample_server_added', 'scope_trail.mcp_sample_unpinned_command']
    );
    assert.equal(report.findings[0].file, 'examples/.mcp.json.windows.example');
    assert.equal(report.findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('CLI git diff snapshots prefixed MCP config example paths', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scopetrail-git-prefixed-sample-'));
  try {
    await execGit(repo, 'init', '-b', 'main');
    await execGit(repo, 'config', 'user.name', 'ScopeTrail Test');
    await execGit(repo, 'config', 'user.email', 'scopetrail@example.invalid');

    await writeFile(join(repo, 'README.md'), 'base\n');
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'base');
    const base = await gitStdout(repo, 'rev-parse', 'HEAD');

    await mkdir(join(repo, 'examples'), { recursive: true });
    await writeFile(
      join(repo, 'examples', 'example_mcp_config.json'),
      `${JSON.stringify(
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
      )}\n`
    );
    await execGit(repo, 'add', '.');
    await execGit(repo, 'commit', '-m', 'add prefixed sample mcp config');
    const head = await gitStdout(repo, 'rev-parse', 'HEAD');

    const { stdout } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--repo', repo, '--base', base, '--head', head, '--format', 'json'],
      { cwd: packageRoot }
    );
    const report = JSON.parse(stdout);

    assert.deepEqual(
      report.findings.map((finding) => finding.kind),
      ['scope_trail.mcp_sample_server_added', 'scope_trail.mcp_sample_unpinned_command']
    );
    assert.equal(report.findings[0].file, 'examples/example_mcp_config.json');
    assert.equal(report.findings.some((finding) => finding.kind === 'scope_trail.mcp_server_added'), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

async function writeConfig(repo, { mcp, claude }) {
  await mkdir(join(repo, '.claude'), { recursive: true });
  await writeFile(join(repo, '.mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`);
  await writeFile(join(repo, '.claude', 'settings.json'), `${JSON.stringify(claude, null, 2)}\n`);
}

async function execGit(repo, ...args) {
  await execFileAsync('git', ['-C', repo, ...args]);
}

async function gitStdout(repo, ...args) {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args]);
  return stdout.trim();
}

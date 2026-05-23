import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');
// On Windows, npm ships as npm.cmd. Node has deprecated spawning shell
// scripts with shell:true (DEP0190), so route through cmd.exe directly
// rather than asking execFile to find the .cmd via the shell.
const npmInvocation = process.platform === 'win32'
  ? { command: 'cmd.exe', extraArgs: ['/c', 'npm'] }
  : { command: 'npm', extraArgs: [] };

// npm pack honors the `files` whitelist in package.json. ScopeTrail
// is a trust-focused CLI that previously shipped fixtures with
// intentionally-risky agent configs (.claude/settings.json, .mcp.json,
// .github/, test/fixtures/) on every npm install — exactly the kind of
// drift the tool is supposed to flag. This test pins the publish
// surface so those files cannot leak back in.
test('npm publish surface only ships runtime files', async () => {
  const { stdout } = await exec(
    npmInvocation.command,
    [...npmInvocation.extraArgs, 'pack', '--dry-run', '--json'],
    { cwd: packageRoot }
  );
  const result = JSON.parse(stdout);
  const files = new Set(result[0].files.map((entry) => entry.path));

  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'action.yml',
    'dist/index.js'
  ]) {
    assert.ok(files.has(required), `npm pack missing required file: ${required}`);
  }

  const forbiddenPrefixes = [
    '.github/',
    '.claude/',
    '.codex/',
    '.cursor/',
    '.vscode/',
    'src/',
    'test/',
    'node_modules/'
  ];
  const forbiddenFiles = [
    '.mcp.json',
    '.gitattributes',
    '.gitignore',
    'tsconfig.json'
  ];

  for (const file of files) {
    for (const prefix of forbiddenPrefixes) {
      assert.ok(
        !file.startsWith(prefix),
        `npm pack should not ship ${file} (prefix ${prefix} is publish-excluded)`
      );
    }
    assert.ok(
      !forbiddenFiles.includes(file),
      `npm pack should not ship ${file} (publish-excluded)`
    );
  }
});

test('git tree does not carry live risky agent configs at the repo root', async () => {
  // The demo PR (#3) for this project intentionally added .mcp.json,
  // .claude/settings.json, and .codex/config.toml at the repo root.
  // It was merged into main and shipped on v0.1.6+ as tracked files —
  // meaning anyone running Claude Code, Codex, or a permission scanner
  // against this checkout loaded a live `stripe-admin` MCP server and
  // broad `Bash(npm *)` / `Read(~/**)` Claude allow rules. The demo is
  // archived on PR #3; the live files have been untracked and the
  // .gitignore now keeps them from coming back.
  const { stdout } = await exec('git', ['ls-files', '-z', '--full-name', '--', '.mcp.json', '.claude', '.codex'], {
    cwd: packageRoot
  });
  const tracked = stdout.split('\0').filter(Boolean);
  assert.deepEqual(tracked, [], `unexpected tracked demo configs at repo root: ${tracked.join(', ')}`);
});

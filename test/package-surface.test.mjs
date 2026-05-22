import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');
const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// npm pack honors the `files` whitelist in package.json. ScopeTrail
// is a trust-focused CLI that previously shipped fixtures with
// intentionally-risky agent configs (.claude/settings.json, .mcp.json,
// .github/, test/fixtures/) on every npm install — exactly the kind of
// drift the tool is supposed to flag. This test pins the publish
// surface so those files cannot leak back in.
test('npm publish surface only ships runtime files', async () => {
  const { stdout } = await exec(npmCli, ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    shell: process.platform === 'win32'
  });
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

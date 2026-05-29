import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');
const cli = join(packageRoot, 'dist', 'index.js');

// npm installs the `scopetrail` bin as a symlink (node_modules/.bin and the
// global bin dir), so the entrypoint's "am I the main module?" check has to
// survive being launched through one. Every other CLI test runs
// `node dist/index.js` directly, which never exercises the symlink path that
// broke real `npm i -g` / `npx` installs: `main()` was silently skipped, so the
// process exited 0 with no output — a CI gate that passes every PR. This test
// runs the built bin through a symlink and asserts it actually produces a report.
test('built bin runs when invoked through a symlink (npm-install path)', async (t) => {
  assert.ok(existsSync(cli), 'dist/index.js must be built before this test (npm run build)');

  const linkDir = mkdtempSync(join(tmpdir(), 'scopetrail-bin-link-'));
  const link = join(linkDir, 'scopetrail');
  try {
    try {
      symlinkSync(cli, link, 'file');
    } catch (error) {
      // Windows without Developer Mode / admin rights cannot create symlinks.
      // Linux CI (the platform npm consumers actually install on) provides the
      // real regression coverage; skip rather than fail on a restricted host.
      if (['EPERM', 'ENOSYS', 'EEXIST'].includes(error.code)) {
        t.skip(`symlink creation unsupported here (${error.code})`);
        return;
      }
      throw error;
    }

    const oldDir = join(testDir, 'fixtures', 'combined', 'old');
    const newDir = join(testDir, 'fixtures', 'combined', 'new');
    const { stdout } = await execFileAsync(process.execPath, [
      link,
      'diff',
      '--old',
      oldDir,
      '--new',
      newDir,
      '--format',
      'json'
    ]);

    // Before the fix this stdout was empty (main() never ran through the
    // symlink), so JSON.parse and the assertions below guard the regression.
    const report = JSON.parse(stdout);
    assert.equal(report.rating, 'critical');
    assert.equal(report.findings.length, 6);
  } finally {
    rmSync(linkDir, { recursive: true, force: true });
  }
});

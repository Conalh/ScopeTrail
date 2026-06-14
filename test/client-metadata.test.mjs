import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');

// Pilot feedback (Abilityai/trinity#911) asked that a finding state *what loads
// it and whether it is active*, not just which file changed. These tests pin
// the `client` / `runtime_active` provenance across the JSON, text, and
// markdown renderers, including the live-vs-sample distinction.

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('JSON findings carry client + runtimeActive provenance, with samples marked inert', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'scopetrail-client-'));
  try {
    const oldDir = join(workDir, 'old');
    const newDir = join(workDir, 'new');

    // Live Cursor surface gains a (pinned) server -> one mcp_server_added.
    await writeJson(join(oldDir, '.cursor', 'mcp.json'), { mcpServers: {} });
    await writeJson(join(newDir, '.cursor', 'mcp.json'), {
      mcpServers: { ctx: { command: 'npx', args: ['-y', '@vendor/ctx@1.2.3'] } }
    });

    // Inert template gains a server -> only surfaces with --include-samples.
    await writeJson(join(oldDir, '.mcp.json.template'), { mcpServers: {} });
    await writeJson(join(newDir, '.mcp.json.template'), {
      mcpServers: { sample: { command: 'npx', args: ['-y', '@vendor/sample@1.0.0'] } }
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        'dist/index.js', 'diff',
        '--old', oldDir, '--new', newDir,
        '--include-samples', '--format', 'json'
      ],
      { cwd: packageRoot }
    );
    const report = JSON.parse(stdout);

    const live = report.findings.find((f) => f.kind === 'scope_trail.mcp_server_added');
    assert.ok(live, 'expected a live mcp_server_added finding');
    assert.equal(live.data.client, 'Cursor');
    assert.equal(live.data.runtimeActive, true);

    const sample = report.findings.find((f) => f.kind === 'scope_trail.mcp_sample_server_added');
    assert.ok(sample, 'expected a sample mcp_sample_server_added finding');
    assert.equal(sample.data.runtimeActive, false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('text and markdown renderers print client and runtime_active for live findings', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'scopetrail-client-text-'));
  try {
    const oldDir = join(workDir, 'old');
    const newDir = join(workDir, 'new');
    await writeJson(join(oldDir, '.mcp.json'), { mcpServers: {} });
    await writeJson(join(newDir, '.mcp.json'), {
      mcpServers: { ctx: { command: 'npx', args: ['-y', '@vendor/ctx@1.2.3'] } }
    });

    const { stdout: text } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'text'],
      { cwd: packageRoot }
    );
    // Project-root `.mcp.json` is the Claude Code project MCP surface, and it is live.
    assert.match(text, /client=Claude Code/);
    assert.match(text, /runtime_active=true/);

    const { stdout: md } = await execFileAsync(
      process.execPath,
      ['dist/index.js', 'diff', '--old', oldDir, '--new', newDir, '--format', 'markdown'],
      { cwd: packageRoot }
    );
    assert.match(md, /Loaded by: `Claude Code` — runtime_active: true/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

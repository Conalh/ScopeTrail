import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const distRoot = join(testDir, '..', 'dist');

const claudeSettings = await import(pathToFileURL(join(distRoot, 'detectors', 'claude-settings.js')).href);
const gitSnapshot = await import(pathToFileURL(join(distRoot, 'git-snapshot.js')).href);
const mcpDetector = await import(pathToFileURL(join(distRoot, 'detectors', 'mcp.js')).href);
const codexDetector = await import(pathToFileURL(join(distRoot, 'detectors', 'codex-config.js')).href);

const { isBroadAllow, detectClaudeSettingsDrift } = claudeSettings;
const { SNAPSHOT_PATHS } = gitSnapshot;

test('SNAPSHOT_PATHS covers every fixed path each detector reads (regression)', () => {
  // Real bug observed before this PR: git-snapshot only listed
  // .mcp.json and .claude/settings.json, so the Action silently missed
  // .cursor/mcp.json, .vscode/mcp.json, .codeium/windsurf/mcp_config.json,
  // and .codex/config.toml. This test fails loudly if a detector adds a
  // fixed target path and the snapshot list isn't updated to match.
  // Dynamic sample MCP paths are covered by the git-diff fixture test.
  const required = new Set([
    ...mcpDetector.MCP_TARGET_PATHS,
    ...claudeSettings.CLAUDE_TARGET_PATHS,
    ...codexDetector.CODEX_TARGET_PATHS
  ]);
  const covered = new Set(SNAPSHOT_PATHS);

  for (const path of required) {
    assert.ok(covered.has(path), `SNAPSHOT_PATHS missing target: ${path}`);
  }
});

test('isBroadAllow: scoped WebFetch / Task / mcp__server__tool are NOT broad', () => {
  assert.equal(isBroadAllow('WebFetch(domain:example.com)'), false);
  assert.equal(isBroadAllow('WebSearch(query:weather)'), false);
  assert.equal(isBroadAllow('Task(explore-codebase)'), false);
  assert.equal(isBroadAllow('mcp__github__get_issue'), false);
  assert.equal(isBroadAllow('mcp__linear__create_ticket'), false);
});

test('isBroadAllow: bare tokens and wildcard scopes ARE broad', () => {
  assert.equal(isBroadAllow('WebFetch'), true);
  assert.equal(isBroadAllow('Task'), true);
  assert.equal(isBroadAllow('Bash(rm -rf *)'), true);
  assert.equal(isBroadAllow('WebFetch(domain:*)'), true);
  assert.equal(isBroadAllow('mcp__github'), true);
  assert.equal(isBroadAllow('mcp__github__*'), true);
  assert.equal(isBroadAllow('mcp__*'), true);
});

test('isBroadAllow: bare Bash/Read/Write/Edit ARE broad (regression for security gap)', () => {
  // Pre-fix gap: bare `"Bash"` grants unlimited shell execution but
  // the regex required a parenthesized scope, so it silently slipped
  // through. Same for `"Read"`/`"Write"`/`"Edit"`. The asymmetry —
  // bare WebFetch was flagged while bare Bash wasn't — was the tell.
  assert.equal(isBroadAllow('Bash'), true);
  assert.equal(isBroadAllow('Read'), true);
  assert.equal(isBroadAllow('Write'), true);
  assert.equal(isBroadAllow('Edit'), true);
});

test('isBroadAllow: narrowly-scoped Bash/Read/Write/Edit stay narrow', () => {
  // The bare-verb fix must not over-fire on legitimate narrow scopes.
  assert.equal(isBroadAllow('Bash(npm test)'), false);
  assert.equal(isBroadAllow('Bash(git status)'), false);
  assert.equal(isBroadAllow('Read(./src/foo.txt)'), false);
  assert.equal(isBroadAllow('Edit(./README.md)'), false);
});

test('Claude detector: hook_added fires when a new hook is introduced', async () => {
  const dir = await makeClaudeFixture(
    { permissions: { allow: [], deny: [] }, hooks: {} },
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/guard.sh' }] }] }
    }
  );
  try {
    const findings = await detectClaudeSettingsDrift(dir.oldRoot, dir.newRoot);
    const added = findings.find((f) => f.kind === 'scope_trail.hook_added');
    assert.ok(added);
    assert.equal(added.subject, 'PreToolUse');
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test('Claude detector: hook_command_changed fires when an existing hook is weakened', async () => {
  const dir = await makeClaudeFixture(
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/strict-guard.sh' }] }] }
    },
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/noop.sh' }] }] }
    }
  );
  try {
    const findings = await detectClaudeSettingsDrift(dir.oldRoot, dir.newRoot);
    const changed = findings.find((f) => f.kind === 'scope_trail.hook_command_changed');
    assert.ok(changed);
    assert.equal(changed.subject, 'PreToolUse');
    assert.equal(changed.severity, 'high'); // PreToolUse is high-impact
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test('Claude detector: hook_command_changed fires when a no-op is appended alongside a strict guard', async () => {
  // Pre-fix gap: when the hook gained an extra command, newCommands.size
  // > oldCommands.size and the previous `size ===` guard skipped the
  // finding. A reviewer could slip a relaxed script in next to a strict
  // one and ScopeTrail stayed silent.
  const dir = await makeClaudeFixture(
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/strict-guard.sh' }] }] }
    },
    {
      permissions: { allow: [], deny: [] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: '/strict-guard.sh' },
              { type: 'command', command: '/noop.sh' }
            ]
          }
        ]
      }
    }
  );
  try {
    const findings = await detectClaudeSettingsDrift(dir.oldRoot, dir.newRoot);
    const changed = findings.find((f) => f.kind === 'scope_trail.hook_command_changed');
    assert.ok(changed, 'expected hook_command_changed when a no-op is appended');
    assert.equal(changed.subject, 'PreToolUse');
    assert.equal(changed.severity, 'high');
    assert.match(changed.message, /added: \/noop\.sh/);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test('Claude detector: hook_command_changed fires when one guard is removed from a multi-guard hook', async () => {
  // Pre-fix gap: when the hook lost a command but the hook name was
  // still present, newCommands.size < oldCommands.size and the
  // `size ===` guard skipped it. Dropping one guard out of two is
  // exactly the weakening case ScopeTrail should catch.
  const dir = await makeClaudeFixture(
    {
      permissions: { allow: [], deny: [] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: '/strict-guard.sh' },
              { type: 'command', command: '/audit-log.sh' }
            ]
          }
        ]
      }
    },
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/audit-log.sh' }] }] }
    }
  );
  try {
    const findings = await detectClaudeSettingsDrift(dir.oldRoot, dir.newRoot);
    const changed = findings.find((f) => f.kind === 'scope_trail.hook_command_changed');
    assert.ok(changed, 'expected hook_command_changed when one of multiple guards is removed');
    assert.equal(changed.subject, 'PreToolUse');
    assert.equal(changed.severity, 'high');
    assert.match(changed.message, /removed: \/strict-guard\.sh/);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test('Claude detector: hook with unchanged command set produces no hook_command_changed finding', async () => {
  // Regression guard for the symmetric-difference logic — same set of
  // commands in a different order or wrapped under a different matcher
  // should not generate noise.
  const dir = await makeClaudeFixture(
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/guard.sh' }] }] }
    },
    {
      permissions: { allow: [], deny: [] },
      hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '/guard.sh' }] }] }
    }
  );
  try {
    const findings = await detectClaudeSettingsDrift(dir.oldRoot, dir.newRoot);
    assert.equal(findings.find((f) => f.kind === 'scope_trail.hook_command_changed'), undefined);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test('Claude detector: scoped MCP grant does not trip the broad-allow finding', async () => {
  const dir = await makeClaudeFixture(
    { permissions: { allow: [], deny: [] }, hooks: {} },
    {
      permissions: { allow: ['mcp__github__get_issue', 'WebFetch(domain:example.com)'], deny: [] },
      hooks: {}
    }
  );
  try {
    const findings = await detectClaudeSettingsDrift(dir.oldRoot, dir.newRoot);
    assert.equal(findings.find((f) => f.kind === 'scope_trail.permission_allow_widened'), undefined);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

async function makeClaudeFixture(oldSettings, newSettings) {
  const root = await mkdtemp(join(tmpdir(), 'scopetrail-test-'));
  const oldRoot = join(root, 'old');
  const newRoot = join(root, 'new');
  await mkdir(join(oldRoot, '.claude'), { recursive: true });
  await mkdir(join(newRoot, '.claude'), { recursive: true });
  await writeFile(join(oldRoot, '.claude', 'settings.json'), JSON.stringify(oldSettings, null, 2));
  await writeFile(join(newRoot, '.claude', 'settings.json'), JSON.stringify(newSettings, null, 2));
  return { root, oldRoot, newRoot };
}

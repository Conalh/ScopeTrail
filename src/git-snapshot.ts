import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { CLAUDE_TARGET_PATHS } from './detectors/claude-settings.js';
import { CODEX_TARGET_PATHS } from './detectors/codex-config.js';
import { MCP_TARGET_PATHS, isMcpSampleConfigPath } from './detectors/mcp.js';

const execFileAsync = promisify(execFile);

// Union of every config path the detectors read. Sourced from each
// detector module so adding a new surface in one place can never leave
// the git-mode snapshot blind to it (the previous hard-coded list missed
// .cursor/mcp.json, .vscode/mcp.json, .codeium/windsurf/mcp_config.json,
// and .codex/config.toml — silently, in the actual GitHub Action path).
export const SNAPSHOT_PATHS: readonly string[] = [
  ...MCP_TARGET_PATHS,
  ...CLAUDE_TARGET_PATHS,
  ...CODEX_TARGET_PATHS
];

export interface GitSnapshot {
  root: string;
  cleanup: () => Promise<void>;
}

export async function materializeGitSnapshot(repo: string, ref: string): Promise<GitSnapshot> {
  await verifyGitRef(repo, ref);

  const root = await mkdtemp(join(tmpdir(), 'scopetrail-snapshot-'));
  let completed = false;
  try {
    for (const relativePath of await snapshotPathsForRef(repo, ref)) {
      const content = await readPathAtRef(repo, ref, relativePath);
      if (content === null) {
        continue;
      }

      const targetPath = join(root, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    }

    completed = true;
    return {
      root,
      cleanup: async () => {
        await rm(root, { recursive: true, force: true });
      }
    };
  } finally {
    if (!completed) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function snapshotPathsForRef(repo: string, ref: string): Promise<string[]> {
  const paths = new Set(SNAPSHOT_PATHS);
  for (const relativePath of await listPathsAtRef(repo, ref)) {
    if (isMcpSampleConfigPath(relativePath)) {
      paths.add(relativePath);
    }
  }

  return [...paths].sort();
}

async function verifyGitRef(repo: string, ref: string): Promise<void> {
  try {
    await execFileAsync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`]);
  } catch (error) {
    // Without wrapping, the raw `execFile` rejection escapes as a Node
    // stack trace mentioning `git rev-parse --verify`. The most common
    // CI cause is a shallow checkout (`fetch-depth: 1`) that doesn't
    // include the PR base ref, so surface that hint up front.
    throw new ScopeTrailError(
      `Could not resolve git ref "${ref}" in ${repo}. ` +
      'If this is a CI run, ensure actions/checkout uses fetch-depth: 0 so the PR base and head are both available locally.',
      { cause: error }
    );
  }
}

export class ScopeTrailError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScopeTrailError';
  }
}

async function listPathsAtRef(repo: string, ref: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', ref], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function readPathAtRef(repo: string, ref: string, relativePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'show', `${ref}:${relativePath}`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    if (isExecError(error)) {
      return null;
    }

    throw error;
  }
}

function isExecError(error: unknown): error is Error & { code?: number | string } {
  return error instanceof Error && 'code' in error;
}

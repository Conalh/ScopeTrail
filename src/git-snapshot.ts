import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
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
  const resolvedRoot = resolve(root);
  let completed = false;
  try {
    for (const relativePath of await snapshotPathsForRef(repo, ref)) {
      const content = await readPathAtRef(repo, ref, relativePath);
      if (content === null) {
        continue;
      }

      // Defense-in-depth: refuse paths that resolve outside the snapshot
      // root. Git normally rejects `..` segments in tracked paths, but
      // we never want a hostile or malformed ref to coax `mkdir` /
      // `writeFile` into clobbering files outside the temp dir.
      const targetPath = join(root, relativePath);
      const resolvedTarget = resolve(targetPath);
      if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
        continue;
      }

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
  // Reject refs whose first byte would be parsed by `git` as a CLI
  // flag rather than a revision (`--upload-pack=...`, `--help`, etc.).
  // `execFile` already blocks shell-metacharacter injection, but
  // execFile passes the value through as a positional argument that
  // git then re-parses against its own option table — so a `-`-leading
  // ref is an argument-injection vector. The detector also reads
  // `ref:relativePath`, so a colon in the ref would re-anchor the
  // object selector; refuse that too. Refs are also rejected if they
  // contain control characters, which git would not accept anyway but
  // we surface a clean error instead of a raw rejection.
  if (!ref || ref.startsWith('-') || ref.includes(':') || /[\x00-\x1f\x7f]/.test(ref)) {
    throw new ScopeTrailError(
      `Invalid git ref "${ref}". Refs cannot start with "-", contain ":", or include control characters.`
    );
  }

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
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', ref], {
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER
    });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (isMaxBufferError(error)) {
      throw new ScopeTrailError(
        `Listing tracked files at git ref "${ref}" exceeded ScopeTrail's ${formatBytes(GIT_MAX_BUFFER)} buffer. ` +
        'The repository likely has more tracked filenames than the snapshot pipeline can hold in memory.',
        { cause: error }
      );
    }
    throw error;
  }
}

async function readPathAtRef(repo: string, ref: string, relativePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'show', `${ref}:${relativePath}`], {
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER
    });
    return stdout;
  } catch (error) {
    // A maxBuffer overflow is structurally different from "file
    // doesn't exist at this ref" — the previous catch-all returned
    // null for both, which would silently drop an oversized config
    // file from the snapshot and let the detector report a clean
    // diff against an empty placeholder. Surface it as a clear error.
    if (isMaxBufferError(error)) {
      throw new ScopeTrailError(
        `Reading "${relativePath}" at git ref "${ref}" exceeded ScopeTrail's ${formatBytes(GIT_MAX_BUFFER)} buffer. ` +
        'Config files larger than the snapshot buffer cannot be analysed; consider splitting the file or filing an issue.',
        { cause: error }
      );
    }
    if (isExecError(error)) {
      return null;
    }

    throw error;
  }
}

const GIT_MAX_BUFFER = 50 * 1024 * 1024;

function isMaxBufferError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

function isExecError(error: unknown): error is Error & { code?: number | string } {
  return error instanceof Error && 'code' in error;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  return `${bytes} bytes`;
}

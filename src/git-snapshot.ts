import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SNAPSHOT_PATHS = ['.mcp.json', '.claude/settings.json'];

export interface GitSnapshot {
  root: string;
  cleanup: () => Promise<void>;
}

export async function materializeGitSnapshot(repo: string, ref: string): Promise<GitSnapshot> {
  await verifyGitRef(repo, ref);

  const root = await mkdtemp(join(tmpdir(), 'scopetrail-snapshot-'));
  let completed = false;
  try {
    for (const relativePath of SNAPSHOT_PATHS) {
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

async function verifyGitRef(repo: string, ref: string): Promise<void> {
  await execFileAsync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`]);
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

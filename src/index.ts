#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { detectClaudeSettingsDrift } from './detectors/claude-settings.js';
import { detectCodexConfigDrift } from './detectors/codex-config.js';
import { detectMcpDrift } from './detectors/mcp.js';
import { materializeGitSnapshot, ScopeTrailError } from './git-snapshot.js';
import {
  createReport,
  isDriftRating,
  meetsFailOnThreshold,
  renderReport,
  type DriftRating,
  type ReportFormat
} from './report.js';

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (argv[0] === 'diff') {
    return runDiff(argv.slice(1));
  }

  process.stderr.write(`Unknown command: ${argv[0]}\n`);
  return 2;
}

async function runDiff(argv: string[]): Promise<number> {
  const parsed = parseDiffArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n${usage()}\n`);
    return 2;
  }

  let oldRoot: string;
  let newRoot: string;
  let cleanup: (() => Promise<void>) | undefined;

  if (parsed.mode === 'directories') {
    oldRoot = parsed.oldRoot;
    newRoot = parsed.newRoot;
  } else {
    try {
      const baseSnapshot = await materializeGitSnapshot(parsed.repo, parsed.base);
      const headSnapshot = await materializeGitSnapshot(parsed.repo, parsed.head);
      oldRoot = baseSnapshot.root;
      newRoot = headSnapshot.root;
      cleanup = async () => {
        await Promise.all([baseSnapshot.cleanup(), headSnapshot.cleanup()]);
      };
    } catch (error) {
      if (error instanceof ScopeTrailError) {
        process.stderr.write(`${error.message}\n`);
        return 2;
      }
      throw error;
    }
  }

  try {
    // Run all detectors once and render the resulting report into
    // every requested output. Previously the GitHub Action invoked
    // the CLI three times for markdown/json/github, which repeated
    // git snapshot materialization and detector work on each call.
    const findings = [
      ...(await detectMcpDrift(oldRoot, newRoot)),
      ...(await detectClaudeSettingsDrift(oldRoot, newRoot)),
      ...(await detectCodexConfigDrift(oldRoot, newRoot))
    ];
    const report = createReport(findings);

    if (parsed.outMarkdown) {
      await writeFile(parsed.outMarkdown, renderReport(report, 'markdown'));
    }
    if (parsed.outJson) {
      await writeFile(parsed.outJson, renderReport(report, 'json'));
    }
    process.stdout.write(renderReport(report, parsed.format));
    if (meetsFailOnThreshold(report.rating, parsed.failOn)) {
      process.stderr.write(
        `ScopeTrail rating ${report.rating} meets --fail-on threshold ${parsed.failOn}.\n`
      );
      return 1;
    }
    return 0;
  } finally {
    await cleanup?.();
  }
}

interface CommonDiffArgs {
  format: ReportFormat;
  outMarkdown?: string;
  outJson?: string;
  failOn: DriftRating;
}

type ParsedDiffArgs =
  | ({ ok: true; mode: 'directories'; oldRoot: string; newRoot: string } & CommonDiffArgs)
  | ({ ok: true; mode: 'git'; repo: string; base: string; head: string } & CommonDiffArgs)
  | { ok: false; error: string };

function parseDiffArgs(argv: string[]): ParsedDiffArgs {
  let oldRoot: string | undefined;
  let newRoot: string | undefined;
  let base: string | undefined;
  let head: string | undefined;
  let repo = process.cwd();
  let format: ReportFormat = 'text';
  let outMarkdown: string | undefined;
  let outJson: string | undefined;
  let failOn: DriftRating = 'none';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === '--old') {
      oldRoot = value;
      index += 1;
    } else if (arg === '--new') {
      newRoot = value;
      index += 1;
    } else if (arg === '--repo') {
      repo = value;
      index += 1;
    } else if (arg === '--base') {
      base = value;
      index += 1;
    } else if (arg === '--head') {
      head = value;
      index += 1;
    } else if (arg === '--format') {
      if (!isReportFormat(value)) {
        return { ok: false, error: `Invalid format: ${value ?? ''}` };
      }
      format = value;
      index += 1;
    } else if (arg === '--out-markdown') {
      if (!value) {
        return { ok: false, error: 'Missing path for --out-markdown.' };
      }
      outMarkdown = value;
      index += 1;
    } else if (arg === '--out-json') {
      if (!value) {
        return { ok: false, error: 'Missing path for --out-json.' };
      }
      outJson = value;
      index += 1;
    } else if (arg === '--fail-on') {
      if (!value || !isDriftRating(value)) {
        return { ok: false, error: `Invalid --fail-on value: ${value ?? ''}. Use none, low, medium, high, or critical.` };
      }
      failOn = value;
      index += 1;
    } else {
      return { ok: false, error: `Unknown argument: ${arg}` };
    }
  }

  const hasDirectoryMode = oldRoot || newRoot;
  const hasGitMode = base || head;

  if (hasDirectoryMode && hasGitMode) {
    return { ok: false, error: 'Use either --old/--new or --base/--head, not both.' };
  }

  if (hasGitMode) {
    if (!base) {
      return { ok: false, error: 'Missing required --base <ref> argument.' };
    }

    if (!head) {
      return { ok: false, error: 'Missing required --head <ref> argument.' };
    }

    return { ok: true, mode: 'git', repo, base, head, format, outMarkdown, outJson, failOn };
  }

  if (!oldRoot) {
    return { ok: false, error: 'Missing required --old <dir> argument or --base <ref> argument.' };
  }

  if (!newRoot) {
    return { ok: false, error: 'Missing required --new <dir> argument.' };
  }

  return { ok: true, mode: 'directories', oldRoot, newRoot, format, outMarkdown, outJson, failOn };
}

function isReportFormat(value: string | undefined): value is ReportFormat {
  return value === 'text' || value === 'markdown' || value === 'json' || value === 'github';
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (invokedPath) {
  process.exitCode = await main();
}

function usage(): string {
  return [
    'Usage:',
    '  scopetrail diff --old <dir> --new <dir> [--format text|markdown|json|github] [--out-markdown PATH] [--out-json PATH] [--fail-on none|low|medium|high|critical]',
    '  scopetrail diff --repo <repo> --base <ref> --head <ref> [--format text|markdown|json|github] [--out-markdown PATH] [--out-json PATH] [--fail-on none|low|medium|high|critical]'
  ].join('\n');
}

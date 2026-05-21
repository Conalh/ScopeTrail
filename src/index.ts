#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { detectClaudeSettingsDrift } from './detectors/claude-settings.js';
import { detectCodexConfigDrift } from './detectors/codex-config.js';
import { detectMcpDrift } from './detectors/mcp.js';
import { materializeGitSnapshot } from './git-snapshot.js';
import { createReport, renderReport, type ReportFormat } from './report.js';

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: scopetrail diff --old <dir> --new <dir> [--format text|markdown|json]\n');
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

  if (parsed.mode === 'directories') {
    const findings = [
      ...(await detectMcpDrift(parsed.oldRoot, parsed.newRoot)),
      ...(await detectClaudeSettingsDrift(parsed.oldRoot, parsed.newRoot)),
      ...(await detectCodexConfigDrift(parsed.oldRoot, parsed.newRoot))
    ];
    process.stdout.write(renderReport(createReport(findings), parsed.format));
    return 0;
  }

  const baseSnapshot = await materializeGitSnapshot(parsed.repo, parsed.base);
  const headSnapshot = await materializeGitSnapshot(parsed.repo, parsed.head);
  try {
    const findings = [
      ...(await detectMcpDrift(baseSnapshot.root, headSnapshot.root)),
      ...(await detectClaudeSettingsDrift(baseSnapshot.root, headSnapshot.root)),
      ...(await detectCodexConfigDrift(baseSnapshot.root, headSnapshot.root))
    ];
    process.stdout.write(renderReport(createReport(findings), parsed.format));
    return 0;
  } finally {
    await Promise.all([baseSnapshot.cleanup(), headSnapshot.cleanup()]);
  }
}

type ParsedDiffArgs =
  | { ok: true; mode: 'directories'; oldRoot: string; newRoot: string; format: ReportFormat }
  | { ok: true; mode: 'git'; repo: string; base: string; head: string; format: ReportFormat }
  | { ok: false; error: string };

function parseDiffArgs(argv: string[]): ParsedDiffArgs {
  let oldRoot: string | undefined;
  let newRoot: string | undefined;
  let base: string | undefined;
  let head: string | undefined;
  let repo = process.cwd();
  let format: ReportFormat = 'text';

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

    return { ok: true, mode: 'git', repo, base, head, format };
  }

  if (!oldRoot) {
    return { ok: false, error: 'Missing required --old <dir> argument or --base <ref> argument.' };
  }

  if (!newRoot) {
    return { ok: false, error: 'Missing required --new <dir> argument.' };
  }

  return { ok: true, mode: 'directories', oldRoot, newRoot, format };
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
    '  scopetrail diff --old <dir> --new <dir> [--format text|markdown|json|github]',
    '  scopetrail diff --repo <repo> --base <ref> --head <ref> [--format text|markdown|json|github]'
  ].join('\n');
}

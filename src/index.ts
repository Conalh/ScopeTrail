#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { detectClaudeSettingsDrift } from './detectors/claude-settings.js';
import { detectMcpDrift } from './detectors/mcp.js';
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
    process.stderr.write(`${parsed.error}\nUsage: scopetrail diff --old <dir> --new <dir> [--format text|markdown|json]\n`);
    return 2;
  }

  const findings = [
    ...(await detectMcpDrift(parsed.oldRoot, parsed.newRoot)),
    ...(await detectClaudeSettingsDrift(parsed.oldRoot, parsed.newRoot))
  ];
  process.stdout.write(renderReport(createReport(findings), parsed.format));
  return 0;
}

type ParsedDiffArgs =
  | { ok: true; oldRoot: string; newRoot: string; format: ReportFormat }
  | { ok: false; error: string };

function parseDiffArgs(argv: string[]): ParsedDiffArgs {
  let oldRoot: string | undefined;
  let newRoot: string | undefined;
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

  if (!oldRoot) {
    return { ok: false, error: 'Missing required --old <dir> argument.' };
  }

  if (!newRoot) {
    return { ok: false, error: 'Missing required --new <dir> argument.' };
  }

  return { ok: true, oldRoot, newRoot, format };
}

function isReportFormat(value: string | undefined): value is ReportFormat {
  return value === 'text' || value === 'markdown' || value === 'json';
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (invokedPath) {
  process.exitCode = await main();
}

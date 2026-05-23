import {
  createFinding as createCanonicalFinding,
  createReport as createCanonicalReport,
  type Finding as CanonicalFinding,
  type Report as CanonicalReport,
} from 'agent-gov-core';
import type { Finding, Severity } from './types.js';

export type DriftRating = 'none' | Severity;
export type ReportFormat = 'text' | 'markdown' | 'json' | 'github';

export interface DriftReport {
  rating: DriftRating;
  findingCount: number;
  findings: Finding[];
}

/**
 * Project a ScopeTrail-internal {@link DriftReport} into the canonical
 * agent-gov-core {@link CanonicalReport} envelope. Used at the JSON
 * serialization boundary so cross-tool meta-reviewers (GovVerdict) ingest
 * one shape across the whole suite. The legacy ScopeTrail finding fields
 * `subject` and `recommendation` ride along under `data.*` per finding so
 * no information is lost. Internal markdown / text / github renderers
 * continue to consume `DriftReport` directly.
 */
function toCanonicalReport(report: DriftReport): CanonicalReport {
  const findings: CanonicalFinding[] = report.findings.map((f) => {
    // Strip the `scope_trail.` namespace prefix because createFinding rebuilds
    // it from `tool` + `name`. The detectors all emit fully-namespaced kinds.
    const name = f.kind.startsWith('scope_trail.')
      ? f.kind.slice('scope_trail.'.length)
      : f.kind;
    const data: Record<string, unknown> = {};
    if (f.subject) data.subject = f.subject;
    if (f.recommendation) data.recommendation = f.recommendation;
    const spec: Parameters<typeof createCanonicalFinding>[0] = {
      tool: 'scope_trail',
      name,
      severity: f.severity,
      message: f.message,
      location: f.line !== undefined ? { file: f.file, line: f.line } : { file: f.file },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    };
    return createCanonicalFinding(spec);
  });
  return createCanonicalReport({ tool: 'scope_trail', findings });
}

const severityRank: Record<DriftRating, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function isDriftRating(value: string): value is DriftRating {
  return value in severityRank;
}

// Returns true when `rating` is at least as severe as `threshold` and
// `threshold` isn't `none`. Used by the CLI's --fail-on gate so non-
// GitHub CI (local pre-push, GitLab, CircleCI) can share the same
// threshold semantics as the Action.
export function meetsFailOnThreshold(rating: DriftRating, threshold: DriftRating): boolean {
  return threshold !== 'none' && severityRank[rating] >= severityRank[threshold];
}

export function createReport(findings: Finding[]): DriftReport {
  return {
    rating: rateFindings(findings),
    findingCount: findings.length,
    findings
  };
}

export function renderReport(report: DriftReport, format: ReportFormat): string {
  if (format === 'json') {
    return `${JSON.stringify(toCanonicalReport(report), null, 2)}\n`;
  }

  if (format === 'markdown') {
    return renderMarkdown(report);
  }

  if (format === 'github') {
    return renderGithubAnnotations(report);
  }

  return renderText(report);
}

function rateFindings(findings: Finding[]): DriftRating {
  let rating: DriftRating = 'none';
  for (const finding of findings) {
    if (severityRank[finding.severity] > severityRank[rating]) {
      rating = finding.severity;
    }
  }

  return rating;
}

function renderMarkdown(report: DriftReport): string {
  const lines = [`# ScopeTrail permission drift: ${report.rating.toUpperCase()}`, ''];

  if (report.findings.length === 0) {
    lines.push('No agent permission drift findings.');
    appendPilotFeedback(lines);
    return `${lines.join('\n')}\n`;
  }

  lines.push(`This diff produced ${report.findingCount} finding${report.findingCount === 1 ? '' : 's'}.`, '');
  for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
    const matches = report.findings.filter((finding) => finding.severity === severity);
    if (matches.length === 0) {
      continue;
    }

    lines.push(`## ${capitalize(severity)}`, '');
    for (const finding of matches) {
      lines.push(`- **${finding.subject}** (${finding.file}): ${finding.message}`);
      lines.push(`  Recommendation: ${finding.recommendation}`);
    }
    lines.push('');
  }

  appendPilotFeedback(lines);
  return `${lines.join('\n').trimEnd()}\n`;
}

function appendPilotFeedback(lines: string[]): void {
  lines.push(
    '',
    '## Feedback',
    '',
    'Trying ScopeTrail in advisory mode? Report false positives or missing config surfaces:',
    '',
    'https://github.com/Conalh/ScopeTrail/issues/new/choose'
  );
}

function renderText(report: DriftReport): string {
  const lines = [`ScopeTrail permission drift: ${report.rating.toUpperCase()}`];
  for (const finding of report.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.subject}: ${finding.message}`);
  }

  if (report.findings.length === 0) {
    lines.push('No agent permission drift findings.');
  }

  return `${lines.join('\n')}\n`;
}

function renderGithubAnnotations(report: DriftReport): string {
  if (report.findings.length === 0) {
    return '';
  }

  return report.findings
    .map((finding) => {
      const title = `ScopeTrail ${finding.severity} permission drift`;
      const message = `${finding.message} Recommendation: ${finding.recommendation}`;
      const properties = [`file=${escapeProperty(finding.file)}`];
      if (finding.line && finding.line > 0) {
        properties.push(`line=${finding.line}`);
      }
      properties.push(`title=${escapeProperty(title)}`);
      return `::warning ${properties.join(',')}::${escapeMessage(message)}`;
    })
    .join('\n') + '\n';
}

function escapeMessage(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function escapeProperty(value: string): string {
  return escapeMessage(value)
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

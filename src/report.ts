import type { Finding, Severity } from './types.js';

export type DriftRating = 'none' | Severity;
export type ReportFormat = 'text' | 'markdown' | 'json';

export interface DriftReport {
  rating: DriftRating;
  findingCount: number;
  findings: Finding[];
}

const severityRank: Record<DriftRating, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function createReport(findings: Finding[]): DriftReport {
  return {
    rating: rateFindings(findings),
    findingCount: findings.length,
    findings
  };
}

export function renderReport(report: DriftReport, format: ReportFormat): string {
  if (format === 'json') {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === 'markdown') {
    return renderMarkdown(report);
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

  return `${lines.join('\n').trimEnd()}\n`;
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

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

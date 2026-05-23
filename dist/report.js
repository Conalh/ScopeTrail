const severityRank = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
};
export function isDriftRating(value) {
    return value in severityRank;
}
// Returns true when `rating` is at least as severe as `threshold` and
// `threshold` isn't `none`. Used by the CLI's --fail-on gate so non-
// GitHub CI (local pre-push, GitLab, CircleCI) can share the same
// threshold semantics as the Action.
export function meetsFailOnThreshold(rating, threshold) {
    return threshold !== 'none' && severityRank[rating] >= severityRank[threshold];
}
export function createReport(findings) {
    return {
        rating: rateFindings(findings),
        findingCount: findings.length,
        findings
    };
}
export function renderReport(report, format) {
    if (format === 'json') {
        return `${JSON.stringify(report, null, 2)}\n`;
    }
    if (format === 'markdown') {
        return renderMarkdown(report);
    }
    if (format === 'github') {
        return renderGithubAnnotations(report);
    }
    return renderText(report);
}
function rateFindings(findings) {
    let rating = 'none';
    for (const finding of findings) {
        if (severityRank[finding.severity] > severityRank[rating]) {
            rating = finding.severity;
        }
    }
    return rating;
}
function renderMarkdown(report) {
    const lines = [`# ScopeTrail permission drift: ${report.rating.toUpperCase()}`, ''];
    if (report.findings.length === 0) {
        lines.push('No agent permission drift findings.');
        appendPilotFeedback(lines);
        return `${lines.join('\n')}\n`;
    }
    lines.push(`This diff produced ${report.findingCount} finding${report.findingCount === 1 ? '' : 's'}.`, '');
    for (const severity of ['critical', 'high', 'medium', 'low']) {
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
function appendPilotFeedback(lines) {
    lines.push('', '## Feedback', '', 'Trying ScopeTrail in advisory mode? Report false positives or missing config surfaces:', '', 'https://github.com/Conalh/ScopeTrail/issues/new/choose');
}
function renderText(report) {
    const lines = [`ScopeTrail permission drift: ${report.rating.toUpperCase()}`];
    for (const finding of report.findings) {
        lines.push(`[${finding.severity.toUpperCase()}] ${finding.subject}: ${finding.message}`);
    }
    if (report.findings.length === 0) {
        lines.push('No agent permission drift findings.');
    }
    return `${lines.join('\n')}\n`;
}
function renderGithubAnnotations(report) {
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
function escapeMessage(value) {
    return value
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
}
function escapeProperty(value) {
    return escapeMessage(value)
        .replaceAll(':', '%3A')
        .replaceAll(',', '%2C');
}
function capitalize(value) {
    return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

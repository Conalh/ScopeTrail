import { createFinding as createCanonicalFinding, createReport as createCanonicalReport, } from 'agent-gov-core';
/**
 * Project a ScopeTrail-internal {@link DriftReport} into the canonical
 * agent-gov-core {@link CanonicalReport} envelope. Used at the JSON
 * serialization boundary so cross-tool meta-reviewers (GovVerdict) ingest
 * one shape across the whole suite. The legacy ScopeTrail finding fields
 * `subject` and `recommendation` ride along under `data.*` per finding so
 * no information is lost. Internal markdown / text / github renderers
 * continue to consume `DriftReport` directly.
 */
function toCanonicalReport(report) {
    const findings = report.findings.map((f) => {
        // Strip the `scope_trail.` namespace prefix because createFinding rebuilds
        // it from `tool` + `name`. The detectors all emit fully-namespaced kinds.
        const name = f.kind.startsWith('scope_trail.')
            ? f.kind.slice('scope_trail.'.length)
            : f.kind;
        const data = {};
        if (f.subject)
            data.subject = f.subject;
        if (f.recommendation)
            data.recommendation = f.recommendation;
        const spec = {
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
            // Config-derived strings (server names, permission patterns, paths)
            // flow into `subject`, `file`, and `message`. Wrap the code-like
            // fields in backticks and escape inline markdown chars in `message`
            // so a hostile config can't inject links, images, raw HTML, or
            // emphasis runs into the PR comment. `recommendation` is hardcoded
            // by detectors, but we escape it for hygiene.
            lines.push(`- **${mdCode(finding.subject)}** (${mdCode(finding.file)}): ${escapeMdInline(finding.message)}`);
            lines.push(`  Recommendation: ${escapeMdInline(finding.recommendation)}`);
        }
        lines.push('');
    }
    appendPilotFeedback(lines);
    return `${lines.join('\n').trimEnd()}\n`;
}
// Escape the markdown inline-syntax characters that a config-controlled
// string could otherwise use to inject formatting, links, images, or
// raw HTML into a rendered PR comment. We intentionally do NOT escape
// punctuation like `.` `-` `+` — block-level constructs only matter at
// line start, and our findings never put untrusted input there.
function escapeMdInline(value) {
    return value.replace(/[\\`*_[\]<>|!]/g, '\\$&');
}
// Wrap a value in a backtick code span. Pick a fence longer than any
// internal backtick run so the value can't break out of the span, and
// pad with a space when it starts or ends with a backtick (the only
// way CommonMark lets a code span begin/end with backtick).
function mdCode(value) {
    const runs = value.match(/`+/g) ?? [];
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = '`'.repeat(longest + 1);
    const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
    return `${fence}${padding}${value}${padding}${fence}`;
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

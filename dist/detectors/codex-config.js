import { readFile } from 'node:fs/promises';
import { configPath } from '../discovery.js';
export const CODEX_CONFIG_FILE = '.codex/config.toml';
export const CODEX_TARGET_PATHS = [CODEX_CONFIG_FILE];
export async function detectCodexConfigDrift(oldRoot, newRoot) {
    const oldConfig = await readCodexConfig(oldRoot);
    const newConfig = await readCodexConfig(newRoot);
    const findings = [];
    for (const key of ['sandbox_mode', 'sandbox', 'windows.sandbox']) {
        const oldEntry = oldConfig.get(key);
        const newEntry = newConfig.get(key);
        if (newEntry && sandboxRank(newEntry.value) > sandboxRank(oldEntry?.value)) {
            findings.push({
                kind: 'scope_trail.codex_sandbox_widened',
                severity: sandboxRank(newEntry.value) >= 3 ? 'critical' : 'high',
                file: CODEX_CONFIG_FILE,
                line: newEntry.line,
                subject: key,
                message: `Codex sandbox setting was widened to ${newEntry.value}.`,
                recommendation: 'Keep Codex sandbox settings as narrow as the workflow allows and review full-access/elevated changes carefully.'
            });
        }
    }
    const oldApproval = oldConfig.get('approval_policy');
    const newApproval = newConfig.get('approval_policy');
    if (newApproval && approvalRank(newApproval.value) > approvalRank(oldApproval?.value)) {
        findings.push({
            kind: 'scope_trail.codex_approval_weakened',
            severity: newApproval.value === 'never' ? 'high' : 'medium',
            file: CODEX_CONFIG_FILE,
            line: newApproval.line,
            subject: 'approval_policy',
            message: `Codex approval policy was weakened to ${newApproval.value}.`,
            recommendation: 'Require human approval for risky commands unless the repository has a reviewed reason to run without prompts.'
        });
    }
    for (const key of ['network_access', 'sandbox_workspace_write.network_access']) {
        const oldEntry = oldConfig.get(key);
        const newEntry = newConfig.get(key);
        if (newEntry?.value === 'true' && oldEntry?.value !== 'true') {
            findings.push({
                kind: 'scope_trail.codex_network_enabled',
                severity: 'medium',
                file: CODEX_CONFIG_FILE,
                line: newEntry.line,
                subject: key,
                message: `Codex network access was enabled for ${key}.`,
                recommendation: 'Confirm network access is needed and that commands cannot exfiltrate secrets or fetch unreviewed code.'
            });
        }
    }
    const oldTrust = oldConfig.get('projects.trust_level');
    const newTrust = newConfig.get('projects.trust_level');
    if (newTrust?.value === 'trusted' && oldTrust?.value !== 'trusted') {
        findings.push({
            kind: 'scope_trail.codex_project_trusted',
            severity: 'high',
            file: CODEX_CONFIG_FILE,
            line: newTrust.line,
            subject: 'projects.trust_level',
            message: 'Codex project trust level was changed to trusted.',
            recommendation: 'Only mark projects trusted when repository instructions, hooks, and tool permissions are reviewed.'
        });
    }
    return findings;
}
async function readCodexConfig(root) {
    let text = '';
    try {
        text = await readFile(configPath(root, CODEX_CONFIG_FILE), 'utf8');
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return new Map();
        }
        throw error;
    }
    return parseTomlEntries(text);
}
function parseTomlEntries(text) {
    const entries = new Map();
    let section = '';
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
        if (sectionMatch) {
            section = normalizeSection(sectionMatch[1]);
            continue;
        }
        const keyMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(trimmed);
        if (!keyMatch) {
            continue;
        }
        const key = normalizeKey(section, keyMatch[1]);
        const value = parseScalarValue(keyMatch[2]);
        if (value !== undefined) {
            entries.set(key, { line: index + 1, value });
        }
    }
    return entries;
}
function normalizeSection(section) {
    const normalized = section.trim().toLowerCase();
    return normalized.startsWith('projects.') ? 'projects' : normalized;
}
function normalizeKey(section, key) {
    const normalizedKey = key.trim().toLowerCase();
    return section ? `${section}.${normalizedKey}` : normalizedKey;
}
function parseScalarValue(rawValue) {
    const trimmed = rawValue.trim();
    const stringMatch = /^"([^"]*)"/.exec(trimmed) ?? /^'([^']*)'/.exec(trimmed);
    if (stringMatch) {
        return stringMatch[1].toLowerCase();
    }
    const bareMatch = /^(true|false|[A-Za-z0-9_.-]+)/.exec(trimmed);
    return bareMatch?.[1].toLowerCase();
}
function sandboxRank(value) {
    if (!value) {
        return -1;
    }
    if (['danger-full-access', 'danger_full_access', 'elevated'].includes(value)) {
        return 3;
    }
    if (['workspace-write', 'workspace_write'].includes(value)) {
        return 1;
    }
    if (['read-only', 'read_only'].includes(value)) {
        return 0;
    }
    return -1;
}
function approvalRank(value) {
    if (!value) {
        return -1;
    }
    if (value === 'never') {
        return 3;
    }
    if (value === 'on-failure') {
        return 2;
    }
    if (value === 'on-request') {
        return 1;
    }
    return 0;
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}

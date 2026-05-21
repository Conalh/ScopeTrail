import { configPath, isRecord, lineOfJsonStringValue, readJsonObjectWithSource } from '../discovery.js';
import type { Finding, Severity } from '../types.js';

const CLAUDE_SETTINGS_FILE = '.claude/settings.json';

export async function detectClaudeSettingsDrift(oldRoot: string, newRoot: string): Promise<Finding[]> {
  const oldSettings = await readClaudeSettings(oldRoot);
  const newSettings = await readClaudeSettings(newRoot);
  const findings: Finding[] = [];

  for (const [permission, line] of newSettings.allow) {
    if (!oldSettings.allow.has(permission) && isBroadAllow(permission)) {
      findings.push({
        kind: 'permission_allow_widened',
        severity: severityForAllow(permission),
        file: CLAUDE_SETTINGS_FILE,
        line,
        subject: permission,
        message: `Claude permission allowlist now includes broad access: ${permission}.`,
        recommendation: 'Prefer the narrowest command/path pattern that supports the workflow.'
      });
    }
  }

  for (const permission of oldSettings.deny.keys()) {
    if (!newSettings.deny.has(permission)) {
      findings.push({
        kind: 'permission_deny_removed',
        severity: severityForRemovedDeny(permission),
        file: CLAUDE_SETTINGS_FILE,
        subject: permission,
        message: `Claude permission deny rule was removed: ${permission}.`,
        recommendation: 'Keep deny rules for secrets, credentials, and protected files unless a reviewer approves the removal.'
      });
    }
  }

  for (const hookName of oldSettings.hooks) {
    if (!newSettings.hooks.has(hookName)) {
      findings.push({
        kind: 'hook_removed',
        severity: isHighImpactHook(hookName) ? 'high' : 'medium',
        file: CLAUDE_SETTINGS_FILE,
        subject: hookName,
        message: `Claude hook "${hookName}" was removed.`,
        recommendation: 'Confirm the removed hook is not enforcing approval, audit logging, or policy checks.'
      });
    }
  }

  return findings;
}

interface ClaudeSettingsModel {
  allow: Map<string, number | undefined>;
  deny: Map<string, number | undefined>;
  hooks: Set<string>;
}

async function readClaudeSettings(root: string): Promise<ClaudeSettingsModel> {
  const source = await readJsonObjectWithSource(configPath(root, CLAUDE_SETTINGS_FILE));
  const json = source.json;
  const permissions = isRecord(json.permissions) ? json.permissions : {};
  const hooks = isRecord(json.hooks) ? json.hooks : {};

  return {
    allow: readStringArrayWithLines(permissions.allow, source.text),
    deny: readStringArrayWithLines(permissions.deny, source.text),
    hooks: new Set(
      Object.entries(hooks)
        .filter(([, value]) => hookHasEntries(value))
        .map(([name]) => name)
    )
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readStringArrayWithLines(value: unknown, sourceText: string): Map<string, number | undefined> {
  return new Map(readStringArray(value).map((entry) => [entry, lineOfJsonStringValue(sourceText, entry)]));
}

function hookHasEntries(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return isRecord(value) && Object.keys(value).length > 0;
}

function isBroadAllow(permission: string): boolean {
  const normalized = permission.toLowerCase();

  return /\bbash\([^)]*\*[^)]*\)/.test(normalized)
    || /\bread\((~|[a-z]:\\|\/|\*\*)/.test(normalized)
    || /\b(write|edit)\((~|[a-z]:\\|\/|\*\*)/.test(normalized)
    || /\b(webfetch|websearch|mcp__|task)\(/.test(normalized);
}

function severityForAllow(permission: string): Severity {
  const normalized = permission.toLowerCase();
  if (normalized.includes('bash(') || normalized.includes('write(') || normalized.includes('edit(')) {
    return 'high';
  }

  return 'medium';
}

function severityForRemovedDeny(permission: string): Severity {
  const normalized = permission.toLowerCase();
  if (normalized.includes('.env') || normalized.includes('secret') || normalized.includes('credential') || normalized.includes('.pem')) {
    return 'critical';
  }

  return 'medium';
}

function isHighImpactHook(hookName: string): boolean {
  return ['pretooluse', 'posttooluse', 'permissionrequest', 'sessionend'].includes(hookName.toLowerCase());
}

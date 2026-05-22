import { configPath, isRecord, lineOfJsonStringValue, readJsonObjectWithSource } from '../discovery.js';
import type { Finding, Severity } from '../types.js';

export const CLAUDE_SETTINGS_FILE = '.claude/settings.json';
export const CLAUDE_TARGET_PATHS: readonly string[] = [CLAUDE_SETTINGS_FILE];

export async function detectClaudeSettingsDrift(oldRoot: string, newRoot: string): Promise<Finding[]> {
  const oldSettings = await readClaudeSettings(oldRoot);
  const newSettings = await readClaudeSettings(newRoot);
  const findings: Finding[] = [];

  for (const [permission, line] of newSettings.allow) {
    if (!oldSettings.allow.has(permission) && isBroadAllow(permission)) {
      findings.push({
        kind: 'scope_trail.permission_allow_widened',
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
        kind: 'scope_trail.permission_deny_removed',
        severity: severityForRemovedDeny(permission),
        file: CLAUDE_SETTINGS_FILE,
        subject: permission,
        message: `Claude permission deny rule was removed: ${permission}.`,
        recommendation: 'Keep deny rules for secrets, credentials, and protected files unless a reviewer approves the removal.'
      });
    }
  }

  for (const [hookName, oldCommands] of oldSettings.hookCommands) {
    if (!newSettings.hookCommands.has(hookName)) {
      findings.push({
        kind: 'scope_trail.hook_removed',
        severity: isHighImpactHook(hookName) ? 'high' : 'medium',
        file: CLAUDE_SETTINGS_FILE,
        subject: hookName,
        message: `Claude hook "${hookName}" was removed.`,
        recommendation: 'Confirm the removed hook is not enforcing approval, audit logging, or policy checks.'
      });
      continue;
    }

    // Any drift in the command set is material — swapping a strict
    // guard for a no-op, dropping one guard out of a multi-guard hook,
    // or appending a no-op alongside the strict guard. The previous
    // check required `newCommands.size === oldCommands.size`, which
    // missed adds and drops that changed the count.
    const newCommands = newSettings.hookCommands.get(hookName) ?? new Set<string>();
    const added = [...newCommands].filter((command) => !oldCommands.has(command));
    const removed = [...oldCommands].filter((command) => !newCommands.has(command));
    if (added.length > 0 || removed.length > 0) {
      findings.push({
        kind: 'scope_trail.hook_command_changed',
        severity: isHighImpactHook(hookName) ? 'high' : 'medium',
        file: CLAUDE_SETTINGS_FILE,
        subject: hookName,
        message: hookCommandChangeMessage(hookName, added, removed),
        recommendation: 'Review the change — a removed guard, a no-op appended next to a strict one, or any rewrite of a hook command can all weaken policy.'
      });
    }
  }

  // Newly-added hooks aren't strictly drift in the security-loss sense,
  // but a PR that *adds* a PreToolUse / PermissionRequest hook is a real
  // policy event the reviewer should see. We flag it at low severity.
  for (const hookName of newSettings.hookCommands.keys()) {
    if (!oldSettings.hookCommands.has(hookName)) {
      findings.push({
        kind: 'scope_trail.hook_added',
        severity: 'low',
        file: CLAUDE_SETTINGS_FILE,
        subject: hookName,
        message: `Claude hook "${hookName}" was added.`,
        recommendation: 'Confirm the new hook is the intended policy surface.'
      });
    }
  }

  return findings;
}

interface ClaudeSettingsModel {
  allow: Map<string, number | undefined>;
  deny: Map<string, number | undefined>;
  hookCommands: Map<string, Set<string>>;
}

async function readClaudeSettings(root: string): Promise<ClaudeSettingsModel> {
  const source = await readJsonObjectWithSource(configPath(root, CLAUDE_SETTINGS_FILE));
  const json = source.json;
  const permissions = isRecord(json.permissions) ? json.permissions : {};
  const hooks = isRecord(json.hooks) ? json.hooks : {};

  return {
    allow: readStringArrayWithLines(permissions.allow, source.text),
    deny: readStringArrayWithLines(permissions.deny, source.text),
    hookCommands: readHookCommands(hooks)
  };
}

// Each Claude Code hook entry is a list of matcher objects whose `hooks`
// field carries the actual command strings:
//
//   { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command",
//                       "command": "/path/guard.sh" }] }] }
//
// We collect every command string per hook name so a PR can be checked
// for both presence and content changes.
function readHookCommands(hooks: Record<string, unknown>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const [name, value] of Object.entries(hooks)) {
    if (!hookHasEntries(value)) {
      continue;
    }

    const commands = new Set<string>();
    const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);

    for (const entry of entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const innerList = entry.hooks;
      if (Array.isArray(innerList)) {
        for (const inner of innerList) {
          if (isRecord(inner) && typeof inner.command === 'string') {
            commands.add(inner.command);
          }
        }
      }
      if (typeof entry.command === 'string') {
        commands.add(entry.command);
      }
    }

    result.set(name, commands);
  }

  return result;
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

// A permission only counts as broad when it grants more than a specific
// scoped target. Scoped forms like `WebFetch(domain:example.com)` and
// `mcp__github__get_issue` are narrow — the previous heuristic flagged
// both as broad, which surfaced false positives on every PR that scoped
// its grants properly. Bare tokens and explicit wildcards are still broad.
export function isBroadAllow(permission: string): boolean {
  const normalized = permission.toLowerCase();

  // Bare verb (no parentheses) or wildcard-scoped verb for any of the
  // dangerous operations. This catches `"Bash"`, `"Read"`, `"Write"`,
  // `"Edit"`, `"WebFetch"`, etc. — bare tokens that grant unlimited
  // access. Previously only WebFetch/WebSearch/Task went through this
  // check, which silently let `"Bash"` and bare `"Read"`/`"Write"`/
  // `"Edit"` slip past unflagged.
  if (isBroadVerbGrant(normalized, ['bash', 'read', 'write', 'edit', 'webfetch', 'websearch', 'task'])) {
    return true;
  }
  // Scoped grants whose target is a rooted path (absolute, home-rel,
  // or Windows drive). `Read(/etc/passwd)` doesn't include `*` but is
  // still broader than a workspace-relative path. Stays separate from
  // the verb-grant check because that path-shape rule only applies to
  // file-access verbs, not network/task verbs.
  if (/\b(read|write|edit)\((~|[a-z]:\\|\/|\*\*)/.test(normalized)) {
    return true;
  }
  if (isBroadMcpGrant(normalized)) {
    return true;
  }
  return false;
}

function isBroadVerbGrant(normalized: string, verbs: string[]): boolean {
  for (const verb of verbs) {
    const match = new RegExp(`\\b${verb}\\b(\\([^)]*\\))?`).exec(normalized);
    if (!match) {
      continue;
    }
    const scope = match[1] ?? '';
    if (scope === '' || scope.includes('*')) {
      return true;
    }
  }
  return false;
}

function isBroadMcpGrant(normalized: string): boolean {
  // Claude Code MCP grants follow `mcp__<server>__<tool>`. Tool names
  // contain underscores (`get_issue`), so we have to split on the
  // literal `__` separator rather than a character class.
  const start = normalized.indexOf('mcp__');
  if (start === -1) {
    return false;
  }
  if (start > 0 && /[a-z0-9_]/.test(normalized[start - 1])) {
    return false;
  }

  const rest = normalized.slice(start + 'mcp__'.length);
  const grant = rest.match(/^[a-z0-9_*-]+/)?.[0] ?? '';
  if (!grant) {
    return true;
  }

  const parts = grant.split('__');
  const server = parts[0];
  const tool = parts.length > 1 ? parts.slice(1).join('__') : undefined;

  if (!server || server.includes('*')) {
    return true;
  }
  return !tool || tool.includes('*');
}

function severityForAllow(permission: string): Severity {
  const normalized = permission.toLowerCase();
  // Match bare verbs (`Bash`, `Write`, `Edit`) and parenthesized
  // scoped grants (`Bash(npm *)`, `Write(./foo)`, `Edit(...)`)
  // uniformly. The previous `includes('bash(')` check required the
  // opening paren, so bare `"Bash"` — which `isBroadAllow` now
  // correctly flags as broad — silently fell to `medium` severity
  // despite granting unlimited shell execution.
  //
  // `read` stays medium even when bare/wildcard — read access is
  // less destructive than execute/modify. Bare `Read` still surfaces
  // as a finding via `isBroadAllow`, just at medium severity.
  if (/\b(bash|write|edit)\b/.test(normalized)) {
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

function hookCommandChangeMessage(hookName: string, added: string[], removed: string[]): string {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added: ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    parts.push(`removed: ${removed.join(', ')}`);
  }
  return `Claude hook "${hookName}" command(s) changed (${parts.join('; ')}).`;
}

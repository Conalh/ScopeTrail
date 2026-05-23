import { readFile } from 'node:fs/promises';
import { lineOfTomlKey, parseToml } from 'agent-gov-core';
import { configPath } from '../discovery.js';
import {
  isUnpinnedCommand,
  serverCommand,
  remoteEndpoint,
  isUnencryptedEndpoint,
  type McpCommandShape
} from '../mcp-risk.js';
import type { Finding } from '../types.js';

export const CODEX_CONFIG_FILE = '.codex/config.toml';
export const CODEX_TARGET_PATHS: readonly string[] = [CODEX_CONFIG_FILE];

interface TomlEntry {
  line: number;
  value: string;
}

interface CodexMcpServer extends McpCommandShape {
  text: string;
  name: string;
}

export async function detectCodexConfigDrift(oldRoot: string, newRoot: string): Promise<Finding[]> {
  // Detect a malformed new .codex/config.toml up front. The previous
  // behavior was to silently swallow the TOML parse error and return
  // an empty MCP server map, which let a hand-edited config that
  // contained risky settings produce a clean "rating: none" report.
  // Surface as a high-severity finding and skip the rest of the
  // detector — diffing against a partially-parsed file would just
  // produce noise.
  const newParseError = await readCodexParseError(newRoot);
  if (newParseError) {
    return [{
      kind: 'scope_trail.codex_config_syntax_error',
      severity: 'high',
      file: CODEX_CONFIG_FILE,
      subject: CODEX_CONFIG_FILE,
      message: `Codex config "${CODEX_CONFIG_FILE}" failed to parse: ${newParseError.message}`,
      recommendation: 'Fix the TOML syntax. ScopeTrail cannot reason about sandbox, approval, or MCP drift while the file is invalid.'
    }];
  }

  const oldConfig = await readCodexConfig(oldRoot);
  const newConfig = await readCodexConfig(newRoot);
  const findings: Finding[] = [];

  for (const key of ['sandbox_mode', 'sandbox', 'windows.sandbox']) {
    const oldEntry = oldConfig.get(key);
    const newEntry = newConfig.get(key);
    if (newEntry && sandboxRank(newEntry.value) > sandboxRank(oldEntry?.value)) {
      findings.push({
        kind: 'scope_trail.codex_sandbox_widened',
        severity: sandboxRank(newEntry.value) >= 3 ? 'critical' : 'high',
        file: CODEX_CONFIG_FILE,
        line: newEntry.line || undefined,
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
      line: newApproval.line || undefined,
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
        line: newEntry.line || undefined,
        subject: key,
        message: `Codex network access was enabled for ${key}.`,
        recommendation: 'Confirm network access is needed and that commands cannot exfiltrate secrets or fetch unreviewed code.'
      });
    }
  }

  // Per-project trust-level detection. The legacy regex parser
  // collapsed every `[projects.<path>]` section to a single `projects`
  // bucket, so multiple project paths fought over one Map key — adding
  // a *second* trusted project went undetected when a first trusted
  // project already existed. Iterate the parsed TOML's `projects`
  // object directly so each path is checked independently.
  const oldTrustedProjects = await readTrustedProjects(oldRoot);
  const newTrustedProjects = await readTrustedProjects(newRoot);
  for (const projectPath of newTrustedProjects) {
    if (!oldTrustedProjects.has(projectPath)) {
      findings.push({
        kind: 'scope_trail.codex_project_trusted',
        severity: 'high',
        file: CODEX_CONFIG_FILE,
        line: lineOfTomlKey(await readCodexText(newRoot), `projects.${projectPath}.trust_level`) || undefined,
        subject: `projects.${projectPath}.trust_level`,
        message: `Codex project "${projectPath}" was marked trusted.`,
        recommendation: 'Only mark projects trusted when repository instructions, hooks, and tool permissions are reviewed.'
      });
    }
  }

  for (const finding of await detectCodexMcpDrift(oldRoot, newRoot)) {
    findings.push(finding);
  }

  return findings;
}

async function readCodexText(root: string): Promise<string> {
  try {
    return await readFile(configPath(root, CODEX_CONFIG_FILE), 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readCodexParseError(root: string): Promise<Error | undefined> {
  const text = await readCodexText(root);
  if (!text) {
    return undefined;
  }
  try {
    parseToml(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function readTrustedProjects(root: string): Promise<Set<string>> {
  const text = await readCodexText(root);
  if (!text) {
    return new Set();
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text);
  } catch {
    return new Set();
  }
  const projects = parsed.projects;
  if (!isPlainObject(projects)) {
    return new Set();
  }
  const trusted = new Set<string>();
  for (const [name, entry] of Object.entries(projects)) {
    if (isPlainObject(entry) && entry.trust_level === 'trusted') {
      trusted.add(name);
    }
  }
  return trusted;
}

// Codex `.codex/config.toml` carries the same `[mcp_servers.NAME]`
// shape that ScopeTrail already flags in `.mcp.json` — without this
// detector, a Codex user can add `[mcp_servers.stripe-admin]` with
// `args = ["-y", "@vendor/stripe-mcp@latest"]` and the unpinned MCP
// risk model never sees it.
async function detectCodexMcpDrift(oldRoot: string, newRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const oldServers = await readCodexMcpServers(oldRoot);
  const newServers = await readCodexMcpServers(newRoot);

  for (const [name, newServer] of newServers) {
    const oldServer = oldServers.get(name);
    const commandChanged = oldServer && serverCommand(newServer) !== serverCommand(oldServer);

    if (!oldServer) {
      findings.push({
        kind: 'scope_trail.codex_mcp_server_added',
        severity: 'high',
        file: CODEX_CONFIG_FILE,
        line: lineForServer(newServer),
        subject: name,
        message: `Codex MCP server "${name}" was added.`,
        recommendation: 'Review the server package, pin its version, and confirm the tools it exposes before merging.'
      });
    } else if (commandChanged) {
      findings.push({
        kind: 'scope_trail.codex_mcp_server_command_changed',
        severity: 'medium',
        file: CODEX_CONFIG_FILE,
        line: lineForServer(newServer),
        subject: name,
        message: `Codex MCP server "${name}" changed its launch command.`,
        recommendation: 'Confirm the command change is intentional and still points at a trusted, pinned package.'
      });
    }

    if ((!oldServer || commandChanged) && isUnpinnedCommand(newServer)) {
      findings.push({
        kind: 'scope_trail.codex_unpinned_mcp_command',
        severity: 'high',
        file: CODEX_CONFIG_FILE,
        line: lineForServer(newServer),
        subject: name,
        message: `Codex MCP server "${name}" uses an unpinned command: ${serverCommand(newServer)}.`,
        recommendation: 'Pin executable packages to an exact version and avoid pipe-to-shell installation commands.'
      });
    }

    const endpoint = remoteEndpoint(newServer);
    if ((!oldServer || commandChanged) && endpoint) {
      const unencrypted = isUnencryptedEndpoint(endpoint);
      findings.push({
        kind: 'scope_trail.codex_mcp_remote_endpoint',
        severity: unencrypted ? 'critical' : 'high',
        file: CODEX_CONFIG_FILE,
        line: lineForServer(newServer),
        subject: name,
        message: unencrypted
          ? `Codex MCP server "${name}" points at an unencrypted remote endpoint: ${endpoint}.`
          : `Codex MCP server "${name}" points at remote endpoint: ${endpoint}.`,
        recommendation: unencrypted
          ? 'Use https:// for remote MCP endpoints — prompt data and tool executions must not go over unencrypted transport.'
          : 'Confirm the endpoint is trusted and does not expose unexpected data or tools to external hosts.'
      });
    }
  }

  return findings;
}

async function readCodexMcpServers(root: string): Promise<Map<string, CodexMcpServer>> {
  const path = configPath(root, CODEX_CONFIG_FILE);
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text);
  } catch {
    return new Map();
  }

  const rawServers = parsed.mcp_servers;
  if (!isPlainObject(rawServers)) {
    return new Map();
  }

  const servers = new Map<string, CodexMcpServer>();
  for (const [name, entry] of Object.entries(rawServers)) {
    if (!isPlainObject(entry)) {
      continue;
    }

    servers.set(name, {
      name,
      text,
      command: typeof entry.command === 'string' ? entry.command : undefined,
      args: Array.isArray(entry.args)
        ? entry.args.filter((arg): arg is string => typeof arg === 'string')
        : undefined,
      url: typeof entry.url === 'string' ? entry.url : undefined,
      serverUrl: typeof entry.serverUrl === 'string'
        ? entry.serverUrl
        : (typeof entry.server_url === 'string' ? entry.server_url : undefined)
    });
  }

  return servers;
}

function lineForServer(server: CodexMcpServer): number | undefined {
  // Point at the leaf the reviewer most needs to see — `command`
  // first, then any of the args/url keys. Fall back to file-level
  // when nothing matches so the finding still surfaces.
  for (const leaf of ['command', 'args', 'url', 'serverUrl', 'server_url']) {
    const line = lineOfTomlKey(server.text, `mcp_servers.${server.name}.${leaf}`);
    if (line) {
      return line;
    }
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readCodexConfig(root: string): Promise<Map<string, TomlEntry>> {
  const text = await readCodexText(root);
  if (!text) {
    return new Map();
  }

  // Use the same parsed-TOML walk as readTrustedProjects so inline
  // tables — `sandbox_workspace_write = { network_access = true }` and
  // `windows = { sandbox = "danger-full-access" }` — surface their leaf
  // keys. The previous line-regex parser stopped at `{` and silently
  // returned rating: "none" for valid TOML that widened the sandbox.
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text);
  } catch {
    // detectCodexConfigDrift already short-circuits on parse errors via
    // readCodexParseError; reaching here with bad TOML shouldn't happen,
    // and an empty map is the right fallback if it does.
    return new Map();
  }

  const entries = new Map<string, TomlEntry>();
  collectTomlEntries(parsed, '', text, entries);
  return entries;
}

function collectTomlEntries(
  node: Record<string, unknown>,
  prefix: string,
  text: string,
  out: Map<string, TomlEntry>
): void {
  for (const [rawKey, value] of Object.entries(node)) {
    const key = rawKey.toLowerCase();
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      collectTomlEntries(value, dotted, text, out);
      continue;
    }
    out.set(dotted, {
      line: locateTomlLine(text, dotted),
      value: stringifyScalar(value)
    });
  }
}

function locateTomlLine(text: string, dottedKey: string): number {
  // Inline tables defeat dotted-key line locators (they collapse to
  // line 0). Walk up the prefix so we still point at the assignment
  // line rather than dropping the locator entirely.
  let current = dottedKey;
  while (current) {
    const line = lineOfTomlKey(text, current);
    if (line > 0) {
      return line;
    }
    const lastDot = current.lastIndexOf('.');
    if (lastDot === -1) {
      return 0;
    }
    current = current.slice(0, lastDot);
  }
  return 0;
}

function stringifyScalar(value: unknown): string {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  return String(value).toLowerCase();
}

function sandboxRank(value: string | undefined): number {
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

function approvalRank(value: string | undefined): number {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

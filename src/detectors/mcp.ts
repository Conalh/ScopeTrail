import { configPath, isRecord, lineOfJsonKey, lineOfJsonStringValue, readJsonObjectWithSource } from '../discovery.js';
import type { Finding, McpServerConfig } from '../types.js';

const MCP_CONFIGS = [
  { path: '.mcp.json', serverKeys: ['mcpServers'] },
  { path: '.cursor/mcp.json', serverKeys: ['mcpServers', 'servers'] },
  { path: '.vscode/mcp.json', serverKeys: ['servers', 'mcpServers'] },
  { path: '.codeium/windsurf/mcp_config.json', serverKeys: ['mcpServers'] }
] as const;

type McpConfigPath = typeof MCP_CONFIGS[number]['path'];

interface McpServerModel extends McpServerConfig {
  line?: number;
  sourceText?: string;
}

export async function detectMcpDrift(oldRoot: string, newRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const config of MCP_CONFIGS) {
    const oldServers = await readMcpServers(oldRoot, config);
    const newServers = await readMcpServers(newRoot, config);

    for (const [name, newServer] of Object.entries(newServers)) {
      const oldServer = oldServers[name];

      if (!oldServer) {
        findings.push({
          kind: 'mcp_server_added',
          severity: 'high',
          file: config.path,
          line: newServer.line,
          subject: name,
          message: `MCP server "${name}" was added.`,
          recommendation: 'Review the server package, pin its version, and confirm the tools it exposes before merging.'
        });
      } else if (serverCommand(newServer) !== serverCommand(oldServer)) {
        findings.push({
          kind: 'mcp_server_command_changed',
          severity: 'medium',
          file: config.path,
          line: lineForServerCommand(newServer) ?? newServer.line,
          subject: name,
          message: `MCP server "${name}" changed its launch command.`,
          recommendation: 'Confirm the command change is intentional and still points at a trusted, pinned package.'
        });
      }

      if ((!oldServer || serverCommand(newServer) !== serverCommand(oldServer)) && isUnpinnedCommand(newServer)) {
        findings.push({
          kind: 'unpinned_mcp_command',
          severity: 'high',
          file: config.path,
          line: lineForUnpinnedCommand(newServer) ?? newServer.line,
          subject: name,
          message: `MCP server "${name}" uses an unpinned command: ${serverCommand(newServer)}.`,
          recommendation: 'Pin executable packages to an exact version and avoid pipe-to-shell installation commands.'
        });
      }
    }
  }

  return findings;
}

async function readMcpServers(
  root: string,
  config: { path: McpConfigPath; serverKeys: readonly string[] }
): Promise<Record<string, McpServerModel>> {
  const source = await readJsonObjectWithSource(configPath(root, config.path));
  const json = source.json;
  const rawServers = readServerMap(json, config.serverKeys);
  if (!isRecord(rawServers)) {
    return {};
  }

  const servers: Record<string, McpServerModel> = {};
  for (const [name, value] of Object.entries(rawServers)) {
    if (!isRecord(value)) {
      continue;
    }

    servers[name] = {
      line: lineOfJsonKey(source.text, name),
      sourceText: source.text,
      command: typeof value.command === 'string' ? value.command : undefined,
      args: Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
      url: typeof value.url === 'string' ? value.url : undefined,
      serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : undefined
    };
  }

  return servers;
}

function readServerMap(json: Record<string, unknown>, serverKeys: readonly string[]): unknown {
  for (const key of serverKeys) {
    if (isRecord(json[key])) {
      return json[key];
    }
  }

  return undefined;
}

function serverCommand(server: McpServerModel): string {
  return [server.command, ...(server.args ?? []), server.url, server.serverUrl].filter(Boolean).join(' ');
}

function isUnpinnedCommand(server: McpServerModel): boolean {
  const command = serverCommand(server);
  const normalized = command.toLowerCase();

  if (normalized.includes('@latest')) {
    return true;
  }

  if (/https:\/\/github\.com\/[^ ]+/.test(normalized)) {
    return true;
  }

  if (/\bcurl\b.+\|\s*(bash|sh)\b/.test(normalized)) {
    return true;
  }

  if (/\b(iwr|invoke-webrequest)\b.+\|\s*(iex|invoke-expression)\b/.test(normalized)) {
    return true;
  }

  const packageLikeArgs = server.args ?? [];
  return ['npx', 'uvx', 'pipx'].includes((server.command ?? '').toLowerCase())
    && packageLikeArgs.some((arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
}

function looksLikePackageName(value: string): boolean {
  return /^[a-z0-9@][a-z0-9._/@-]+$/i.test(value) && !value.startsWith('-');
}

function hasExactVersion(value: string): boolean {
  const packageVersion = value.startsWith('@') ? value.indexOf('@', 1) : value.indexOf('@');
  if (packageVersion === -1) {
    return false;
  }

  const version = value.slice(packageVersion + 1);
  return /^\d+\.\d+\.\d+/.test(version);
}

function lineForServerCommand(server: McpServerModel): number | undefined {
  return firstLineForValues(server, [server.command, ...(server.args ?? []), server.url, server.serverUrl]) ?? server.line;
}

function lineForUnpinnedCommand(server: McpServerModel): number | undefined {
  const command = serverCommand(server);
  const normalized = command.toLowerCase();
  if (normalized.includes('@latest')) {
    return firstLineForValues(server, [server.command, ...(server.args ?? []), server.url, server.serverUrl], (value) =>
      value.toLowerCase().includes('@latest')
    );
  }

  if (/\b(curl|iwr|invoke-webrequest)\b/.test(normalized)) {
    return firstLineForValues(server, [server.command, ...(server.args ?? []), server.url, server.serverUrl]);
  }

  if (['npx', 'uvx', 'pipx'].includes((server.command ?? '').toLowerCase())) {
    return firstLineForValues(server, server.args ?? [], (arg) => looksLikePackageName(arg) && !hasExactVersion(arg));
  }

  if (/https:\/\/github\.com\/[^ ]+/.test(normalized)) {
    return firstLineForValues(server, [server.url, server.serverUrl, ...(server.args ?? [])], (value) =>
      value.toLowerCase().includes('https://github.com/')
    );
  }

  return server.line;
}

function firstLineForValues(
  server: McpServerModel,
  values: Array<string | undefined>,
  predicate: (value: string) => boolean = () => true
): number | undefined {
  const source = getSourceText(server);
  for (const value of values) {
    if (value && predicate(value)) {
      const line = lineOfJsonStringValue(source, value);
      if (line) {
        return line;
      }
    }
  }

  return undefined;
}

function getSourceText(server: McpServerModel): string {
  return server.sourceText ?? '';
}

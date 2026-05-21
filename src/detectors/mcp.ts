import { configPath, isRecord, readJsonObject } from '../discovery.js';
import type { Finding, McpServerConfig } from '../types.js';

const MCP_FILE = '.mcp.json';

export async function detectMcpDrift(oldRoot: string, newRoot: string): Promise<Finding[]> {
  const oldServers = await readMcpServers(oldRoot);
  const newServers = await readMcpServers(newRoot);
  const findings: Finding[] = [];

  for (const [name, newServer] of Object.entries(newServers)) {
    const oldServer = oldServers[name];

    if (!oldServer) {
      findings.push({
        kind: 'mcp_server_added',
        severity: 'high',
        file: MCP_FILE,
        subject: name,
        message: `MCP server "${name}" was added.`,
        recommendation: 'Review the server package, pin its version, and confirm the tools it exposes before merging.'
      });
    } else if (serverCommand(newServer) !== serverCommand(oldServer)) {
      findings.push({
        kind: 'mcp_server_command_changed',
        severity: 'medium',
        file: MCP_FILE,
        subject: name,
        message: `MCP server "${name}" changed its launch command.`,
        recommendation: 'Confirm the command change is intentional and still points at a trusted, pinned package.'
      });
    }

    if ((!oldServer || serverCommand(newServer) !== serverCommand(oldServer)) && isUnpinnedCommand(newServer)) {
      findings.push({
        kind: 'unpinned_mcp_command',
        severity: 'high',
        file: MCP_FILE,
        subject: name,
        message: `MCP server "${name}" uses an unpinned command: ${serverCommand(newServer)}.`,
        recommendation: 'Pin executable packages to an exact version and avoid pipe-to-shell installation commands.'
      });
    }
  }

  return findings;
}

async function readMcpServers(root: string): Promise<Record<string, McpServerConfig>> {
  const json = await readJsonObject(configPath(root, MCP_FILE));
  const rawServers = json.mcpServers;
  if (!isRecord(rawServers)) {
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(rawServers)) {
    if (!isRecord(value)) {
      continue;
    }

    servers[name] = {
      command: typeof value.command === 'string' ? value.command : undefined,
      args: Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
      url: typeof value.url === 'string' ? value.url : undefined
    };
  }

  return servers;
}

function serverCommand(server: McpServerConfig): string {
  return [server.command, ...(server.args ?? []), server.url].filter(Boolean).join(' ');
}

function isUnpinnedCommand(server: McpServerConfig): boolean {
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

import { isMcpSampleConfigPath } from './detectors/mcp.js';

// Pilot feedback (Abilityai/trinity#911) asked that a finding say *what loads
// it and whether it is active* — not just which file changed. A reviewer
// shouldn't need to know that `.cursor/mcp.json` is Cursor's surface while
// `.mcp.json.template` is an inert example. This module is the single source
// of truth mapping a config path to its client and runtime-active status, so
// the detectors stay focused on detection and every output format renders the
// same answer.

export interface ConfigClientInfo {
  // Human-readable agent/editor that loads the surface.
  client: string;
  // True when the file is read into a live agent runtime; false for
  // sample/template/disabled configs that no agent ever loads.
  runtimeActive: boolean;
}

// Suffix → client for the live runtime surfaces ScopeTrail diffs. Matched
// against the finding's relative config path (which is always one of these
// exact paths for the live detectors), so an exact or trailing-segment match
// is enough.
const RUNTIME_SUFFIX_CLIENTS: ReadonlyArray<readonly [suffix: string, client: string]> = [
  ['.cursor/mcp.json', 'Cursor'],
  ['.vscode/mcp.json', 'VS Code'],
  ['.codeium/windsurf/mcp_config.json', 'Windsurf'],
  ['.claude/settings.json', 'Claude Code'],
  ['.codex/config.toml', 'Codex']
];

export function describeConfigClient(file: string): ConfigClientInfo {
  const normalized = file.replaceAll('\\', '/');

  // Sample/template/disabled configs are inert by definition. Resolve the
  // client they *would* belong to for context, but they are never active.
  if (isMcpSampleConfigPath(normalized)) {
    return { client: sampleClient(normalized), runtimeActive: false };
  }

  for (const [suffix, client] of RUNTIME_SUFFIX_CLIENTS) {
    if (normalized === suffix || normalized.endsWith(`/${suffix}`)) {
      return { client, runtimeActive: true };
    }
  }

  // Project-root `.mcp.json` — the standard project MCP file Claude Code loads.
  if (basename(normalized) === '.mcp.json') {
    return { client: 'Claude Code', runtimeActive: true };
  }

  // Every finding ScopeTrail emits comes from a path above, so this is a
  // defensive fallback rather than an expected branch: report it as active so
  // an unrecognized live surface is never silently downgraded to "inert".
  return { client: 'unknown', runtimeActive: true };
}

// Best-effort client label for a sample/template path. The runtimeActive=false
// flag already carries "this is inert", so the label is just the family the
// example belongs to (`cursor_mcp_config.json.sample` → Cursor).
function sampleClient(file: string): string {
  const lower = file.toLowerCase();
  if (lower.includes('cursor')) return 'Cursor';
  if (lower.includes('windsurf') || lower.includes('codeium')) return 'Windsurf';
  if (lower.includes('vscode')) return 'VS Code';
  if (lower.includes('claude')) return 'Claude Code';
  return 'MCP';
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

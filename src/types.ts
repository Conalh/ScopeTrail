export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  kind: string;
  severity: Severity;
  file: string;
  line?: number;
  subject: string;
  message: string;
  recommendation: string;
  // Which agent/editor client actually loads this config surface (e.g.
  // "Cursor", "Claude Code", "Codex"). Lets a reviewer see *what* would
  // pick up the change without knowing every tool's config-path convention.
  client?: string;
  // Whether the surface loads into a live agent runtime. Sample/template/
  // disabled configs (`.mcp.json.template`, `.sample`, ...) are `false`:
  // they never load, so a change to one can't alter what an agent can do.
  // Derived centrally at report time; see clients.ts.
  runtimeActive?: boolean;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  serverUrl?: string;
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  cwd?: string;
}

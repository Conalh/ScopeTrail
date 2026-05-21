export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  kind: string;
  severity: Severity;
  file: string;
  subject: string;
  message: string;
  recommendation: string;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
}

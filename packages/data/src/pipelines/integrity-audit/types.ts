export type Severity = "error" | "warning" | "info";

export interface CheckResult {
  category: string;
  severity: Severity;
  expected: number | string;
  actual: number | string;
  sample: unknown[];
  detail: string;
}

export interface AuditReport {
  ranAt: string;
  durationMs: number;
  dbHost: string;
  results: CheckResult[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
  };
}

export interface CheckContext {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<T[]>;
}

export type Check = (ctx: CheckContext) => Promise<CheckResult[]>;

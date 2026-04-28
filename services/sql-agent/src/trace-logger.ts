import * as fs from 'fs';
import * as path from 'path';
import { ensureParentDirectory, safeJSONStringify } from './safe-json';

export type TraceFailureCategory =
  | 'schema_understanding'
  | 'sql_generation'
  | 'sql_execution'
  | 'model_invocation'
  | 'tool_execution'
  | 'system'
  | 'none';

export type TraceEventType =
  | 'run_started'
  | 'model_input'
  | 'model_output'
  | 'tool_start'
  | 'tool_result'
  | 'sql_generated'
  | 'sql_result'
  | 'diagnostic'
  | 'error'
  | 'final_answer'
  | 'run_completed';

export interface TraceEvent {
  traceId: string;
  timestamp: string;
  type: TraceEventType;
  summary: string;
  round?: number;
  failureCategory?: TraceFailureCategory;
  data?: unknown;
}

const TRACE_ROOT_DIR = path.resolve(__dirname, '../logs/traces');

function ensureTraceDirectory(): void {
  fs.mkdirSync(TRACE_ROOT_DIR, { recursive: true });
}

function formatDatePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function createTraceId(): string {
  return `trace-${formatDatePart(new Date())}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentTraceSession {
  readonly traceId: string;
  readonly filePath: string;

  constructor(traceId?: string) {
    ensureTraceDirectory();
    this.traceId = traceId || createTraceId();
    this.filePath = path.join(TRACE_ROOT_DIR, `${this.traceId}.jsonl`);
    ensureParentDirectory(this.filePath);
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf8');
    }
  }

  log(event: Omit<TraceEvent, 'traceId' | 'timestamp'>): void {
    const entry: TraceEvent = {
      traceId: this.traceId,
      timestamp: new Date().toISOString(),
      ...event,
    };

    fs.appendFileSync(this.filePath, `${safeJSONStringify(entry)}\n`, 'utf8');
  }
}

export function createAgentTraceSession(): AgentTraceSession {
  return new AgentTraceSession();
}

export function clearTraceLogs(): void {
  if (fs.existsSync(TRACE_ROOT_DIR)) {
    fs.rmSync(TRACE_ROOT_DIR, { recursive: true, force: true });
  }
  ensureTraceDirectory();
}

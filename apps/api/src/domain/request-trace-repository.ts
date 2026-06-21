export type RequestTraceOutcome = "succeeded" | "failed";

export interface RequestTraceRecord {
  requestId: string;
  correlationId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  outcome: RequestTraceOutcome;
  errorCode?: string | null;
  playerId?: string | null;
  sessionId?: string | null;
  spinId?: string | null;
  adminActor?: string | null;
  occurredAt: string;
}

export interface RequestTraceRepository {
  record(trace: RequestTraceRecord): void | Promise<void>;
  list(): RequestTraceRecord[] | Promise<RequestTraceRecord[]>;
}

export class InMemoryRequestTraceRepository implements RequestTraceRepository {
  private readonly traces: RequestTraceRecord[] = [];

  public record(trace: RequestTraceRecord): void {
    this.traces.push({ ...trace });
  }

  public list(): RequestTraceRecord[] {
    return this.traces.map((trace) => ({ ...trace }));
  }
}

export type RequestTraceOutcome = "succeeded" | "failed";

export interface RequestTraceRecord {
  correlationId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  outcome: RequestTraceOutcome;
  occurredAt: string;
}

export interface RequestTraceRepository {
  record(trace: RequestTraceRecord): void;
  list(): RequestTraceRecord[];
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

import { type LogContext, type LogEvent, type Logger } from "../../application/ports.ts";

const numeric = [
  "pageSequence",
  "leaseGeneration",
  "inserted",
  "updated",
  "duplicates",
  "rejected",
  "count",
  "durationMs",
] as const;
const identifiers = ["sourceSlug", "runId", "taskId", "errorCode"] as const;
export class StructuredLogger implements Logger {
  constructor(private readonly sink: (entry: string) => void = console.log) {}
  log(event: LogEvent, context: LogContext): void {
    const safe: Record<string, string | number> = { event };
    for (const field of numeric) {
      const value = context[field];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[field] = value;
    }
    for (const field of identifiers) {
      const value = context[field];
      if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) safe[field] = value;
    }
    this.sink(JSON.stringify(safe));
  }
}

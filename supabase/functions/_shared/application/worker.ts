import { assess } from "../domain/assessment.ts";
import { DomainError } from "../domain/model.ts";
import { collect } from "./collect.ts";
import {
  type Clock,
  type HttpClient,
  type Lease,
  type Logger,
  ProcessingError,
  type Repository,
  type SourceAdapter,
} from "./ports.ts";

export interface WorkerDependencies {
  repository: Repository;
  adapters: ReadonlyMap<string, SourceAdapter>;
  clock: Clock;
  http: HttpClient;
  logger: Logger;
}
export interface WorkerResult {
  claimed: number;
  completed: number;
  failed: number;
  leaseLost: number;
}
export function retryDelay(lease: Lease, retryAfter: number): number {
  const jitter = [...lease.id].reduce((n, ch) => (n + ch.charCodeAt(0)) % 11, 0);
  return Math.min(86400, Math.max(retryAfter, 30 * 2 ** (lease.attempt - 1) + jitter));
}
export async function executeLease(
  lease: Lease,
  deps: WorkerDependencies,
  signal: AbortSignal,
): Promise<void> {
  if (lease.kind === "collect_page") {
    await collect(lease, deps, signal);
    return;
  }
  const context = await deps.repository.assessment(lease, signal);
  const now = deps.clock.now();
  const results = context.opportunities.map((o) =>
    assess(
      o,
      context.profile,
      context.states[o.id] ?? { saved: false, ignored: false },
      now,
      context.enabledTypes,
    )
  );
  await deps.repository.storeAssessments(lease, results, signal);
  deps.logger.log("assessment_stored", {
    taskId: lease.id,
    count: results.length,
    leaseGeneration: lease.generation,
  });
}
export async function runWorker(
  deps: WorkerDependencies,
  input: { owner: string; maxTasks?: number; signal?: AbortSignal },
): Promise<WorkerResult> {
  const maximum = input.maxTasks ?? 5;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5) {
    throw new ProcessingError("worker_batch_invalid");
  }
  const started = Date.parse(deps.clock.now()), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  const signal = input.signal
    ? AbortSignal.any([input.signal, controller.signal])
    : controller.signal;
  const result: WorkerResult = { claimed: 0, completed: 0, failed: 0, leaseLost: 0 };
  try {
    for (
      let index = 0;
      index < maximum && !signal.aborted && Date.parse(deps.clock.now()) - started < 45000;
      index++
    ) {
      const lease = await deps.repository.claim(
        input.owner,
        ["collect_page", "assess_batch"],
        signal,
      );
      if (!lease) break;
      result.claimed++;
      deps.logger.log("task_started", { taskId: lease.id, leaseGeneration: lease.generation });
      try {
        await executeLease(lease, deps, signal);
        result.completed++;
      } catch (error) {
        if (signal.aborted) {
          result.leaseLost++;
          break;
        }
        const safe = error instanceof ProcessingError ? error : new ProcessingError(
          error instanceof DomainError ? error.code : "unexpected_task_failure",
        );
        if (safe.code === "lease_stale") {
          result.leaseLost++;
          deps.logger.log("lease_lost", { taskId: lease.id, errorCode: safe.code });
          continue;
        }
        try {
          await deps.repository.finish(
            lease,
            safe.canceled ? "canceled" : safe.retryable ? "retry" : "failed",
            safe.code,
            retryDelay(lease, safe.retryAfter),
            signal,
          );
          result.failed++;
          deps.logger.log("task_failed", { taskId: lease.id, errorCode: safe.code });
        } catch (failure) {
          if (!(failure instanceof ProcessingError) || failure.code !== "lease_stale") {
            throw failure;
          }
          result.leaseLost++;
        }
      }
    }
    deps.logger.log("worker_finished", {
      count: result.claimed,
      durationMs: Math.max(0, Date.parse(deps.clock.now()) - started),
    });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

import type { Logger } from 'pino';
import {
  DEFAULT_RETRY,
  type FinalFailureHandler,
  type JobHandlers,
  type JobName,
  type JobPayloads,
  type JobQueue,
  type RetryPolicy,
} from './types.js';

/**
 * In-process queue: enqueue returns immediately, the job runs asynchronously
 * with the same attempts/backoff policy as the BullMQ path. Jobs die with the
 * process — acceptable because uploads are resumable and deletions are
 * re-triggerable; documented trade-off of running without Redis.
 */
export function createInlineQueue(logger: Logger, retry: RetryPolicy = DEFAULT_RETRY): JobQueue {
  let handlers: JobHandlers | undefined;
  let onFinalFailure: FinalFailureHandler | undefined;
  const inFlight = new Set<Promise<void>>();

  async function runWithRetries<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
  ): Promise<void> {
    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      try {
        await handlers![name](payload);
        return;
      } catch (error) {
        if (attempt === retry.attempts) {
          logger.error({ job: name, attempt }, 'Job failed permanently');
          await onFinalFailure?.(name, payload, error).catch(() => undefined);
          return;
        }
        logger.warn({ job: name, attempt }, 'Job failed, retrying');
        await sleep(retry.backoffMs * 2 ** (attempt - 1));
      }
    }
  }

  return {
    register(h, f) {
      handlers = h;
      onFinalFailure = f;
    },
    async enqueue(name, payload) {
      if (!handlers) {
        throw new Error('Queue used before register()');
      }
      const job = runWithRetries(name, payload).finally(() => inFlight.delete(job));
      inFlight.add(job);
    },
    async drain() {
      // New jobs may be enqueued by running jobs — loop until quiet.
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

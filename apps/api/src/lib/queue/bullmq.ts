import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import {
  DEFAULT_RETRY,
  type FinalFailureHandler,
  type JobHandlers,
  type JobName,
  type JobPayloads,
  type JobQueue,
} from './types.js';

const QUEUE_NAME = 'pocketverse-jobs';

/** Redis-backed queue: jobs survive restarts and retry with backoff. */
export function createBullMqQueue(redisUrl: string, logger: Logger): JobQueue {
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: DEFAULT_RETRY.attempts,
      backoff: { type: 'exponential', delay: DEFAULT_RETRY.backoffMs },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

  let worker: Worker | undefined;

  return {
    register(handlers: JobHandlers, onFinalFailure: FinalFailureHandler) {
      worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          const name = job.name as JobName;
          await handlers[name](job.data as never);
        },
        { connection, concurrency: 2 },
      );
      worker.on('failed', (job, error) => {
        if (!job) {
          return;
        }
        const attemptsAllowed = job.opts.attempts ?? DEFAULT_RETRY.attempts;
        if (job.attemptsMade >= attemptsAllowed) {
          void onFinalFailure(job.name as JobName, job.data as JobPayloads[JobName], error).catch(
            () => undefined,
          );
        }
      });
      worker.on('error', (error) => {
        logger.error({ err: error }, 'Queue worker error');
      });
    },
    async enqueue(name, payload) {
      await queue.add(name, payload);
    },
    async drain() {
      // Redis-backed jobs finish on their own schedule; nothing to await here.
    },
  };
}

/**
 * Job queue boundary. Handoff requires every Telegram transfer to run through
 * a queue with FLOOD_WAIT-aware backoff: with REDIS_URL set jobs run on
 * BullMQ; without it an in-process runner applies the same retry policy
 * (dev, tests, single-instance free tier without Redis).
 */

export interface JobPayloads {
  /** Upload one staged chunk to the user's storage channel. */
  'chunk-upload': { fileId: string; chunkIndex: number; stagingPath: string };
  /** Delete chunk messages from the user's storage channel. */
  'messages-delete': { userId: string; messageIds: string[] };
}

export type JobName = keyof JobPayloads;

export type JobHandlers = {
  [N in JobName]: (payload: JobPayloads[N]) => Promise<void>;
};

/** Called once a job has exhausted all retry attempts. */
export type FinalFailureHandler = (
  name: JobName,
  payload: JobPayloads[JobName],
  error: unknown,
) => Promise<void>;

export interface JobQueue {
  /** Wire up the workers. Must be called exactly once before enqueue. */
  register(handlers: JobHandlers, onFinalFailure: FinalFailureHandler): void;
  enqueue<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void>;
  /** Resolves when every already-enqueued job has settled (tests, shutdown). */
  drain(): Promise<void>;
}

export interface RetryPolicy {
  attempts: number;
  backoffMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 5, backoffMs: 3000 };

/**
 * Per-key async mutex. Telegram tolerates one consumer per session badly —
 * concurrent requests on the same account invite FLOOD_WAITs and races — so
 * every user's Telegram operations are serialized through this.
 */
export type KeyedMutex = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<unknown>>();

  return function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.finally(() => {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    });
    return run;
  };
}

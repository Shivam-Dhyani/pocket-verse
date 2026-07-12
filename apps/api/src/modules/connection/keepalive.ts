import type { PrismaClient, StorageConnection } from '@prisma/client';
import type { Logger } from 'pino';
import type { MasterKeyring } from '../../lib/crypto/index.js';
import type { TelegramGateway } from '../../lib/telegram/gateway.js';
import { AuditEventTypes, type AuditService } from '../audit/audit.service.js';
import { decryptConnectionSession, requireChannel } from './session.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface KeepAliveDeps {
  prisma: PrismaClient;
  gateway: TelegramGateway;
  keyring: MasterKeyring;
  audit: AuditService;
  logger: Logger;
  /** Connections untouched for this long get a keep-alive ping. */
  staleAfterDays?: number;
  /** How often the sweep runs. */
  intervalMs?: number;
}

/**
 * Storage platforms delete accounts that stay inactive too long, taking every
 * stored file with them. Any authenticated API activity counts as "alive", so
 * this sweep periodically makes one cheap health call for each connection that
 * hasn't been touched in a while — keeping even dormant users' accounts (and
 * therefore their files) safe without them lifting a finger.
 *
 * Failures never crash the sweep: a broken connection is marked ERROR with an
 * audit event (same as the user-triggered health check) and skipped next time
 * until reconnected.
 */
export function createKeepAlive({
  prisma,
  gateway,
  keyring,
  audit,
  logger,
  staleAfterDays = 30,
  intervalMs = DAY_MS,
}: KeepAliveDeps) {
  async function touch(connection: StorageConnection): Promise<void> {
    try {
      const session = decryptConnectionSession(connection, keyring);
      await gateway.checkHealth(session, requireChannel(connection));
      await prisma.storageConnection.update({
        where: { id: connection.id },
        data: { lastCheckedAt: new Date(), lastError: null },
      });
      logger.info({ connectionId: connection.id }, 'keep-alive ping ok');
    } catch (error) {
      await prisma.storageConnection.update({
        where: { id: connection.id },
        data: {
          status: 'ERROR',
          lastCheckedAt: new Date(),
          lastError: 'The storage connection is not responding.',
        },
      });
      await audit.record(connection.userId, AuditEventTypes.CONNECTION_HEALTH_FAILED);
      logger.warn({ err: error, connectionId: connection.id }, 'keep-alive ping failed');
    }
  }

  async function sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterDays * DAY_MS);
    const stale = await prisma.storageConnection.findMany({
      where: {
        status: 'CONNECTED',
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }],
      },
    });
    for (const connection of stale) {
      await touch(connection);
    }
    return stale.length;
  }

  let timer: NodeJS.Timeout | null = null;

  return {
    sweep,
    start(): void {
      if (timer) {
        return;
      }
      // One pass shortly after boot (free-tier hosts sleep, so "on wake" is a
      // meaningful moment to catch up), then on the regular interval.
      const run = () =>
        void sweep().catch((error) => logger.warn({ err: error }, 'keep-alive sweep failed'));
      setTimeout(run, 30_000).unref();
      timer = setInterval(run, intervalMs);
      timer.unref(); // never keep the process alive just for the sweep
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

export type KeepAlive = ReturnType<typeof createKeepAlive>;

// Must be first: fills process.env from .env files before validation runs.
import './config/load-env-files.js';
// Second: init Sentry before app modules load so Express is auto-instrumented.
import './instrument.js';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadMasterKeyring } from './lib/crypto/index.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';
import { createGramjsGateway } from './lib/telegram/gramjs.js';
import { createAuditService } from './modules/audit/audit.service.js';
import { createKeepAlive } from './modules/connection/keepalive.js';

const env = loadEnv();
const logger = createLogger({ pretty: env.NODE_ENV === 'development' });
const prisma = getPrisma();
const gateway = createGramjsGateway({
  apiId: env.TELEGRAM_API_ID,
  apiHash: env.TELEGRAM_API_HASH,
});

// createApp fails fast on an unusable keyring — better than failing at first use.
const app = createApp({ env, prisma, logger, gateway });

// Periodically touch dormant storage connections so the platform's account
// inactivity rule never silently deletes a user's files.
const keepAlive = createKeepAlive({
  prisma,
  gateway,
  keyring: loadMasterKeyring(env),
  audit: createAuditService({ prisma, logger }),
  logger,
});
keepAlive.start();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Pocketverse API listening');
});

// Graceful shutdown: hosts (Render, Docker, …) send SIGTERM on deploys and
// scale-downs. Stop taking new connections, then release resources — so an
// in-flight upload part gets its response instead of a cut socket.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  keepAlive.stop();
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  // Hard exit if connections refuse to drain (well under Render's 30s grace).
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

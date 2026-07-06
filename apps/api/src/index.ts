import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadMasterKeyring } from './lib/crypto/index.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';

const env = loadEnv();
const logger = createLogger({ pretty: env.NODE_ENV === 'development' });

// Fail fast: a boot with an unusable keyring must never serve traffic.
loadMasterKeyring(env);

const app = createApp({ env, prisma: getPrisma(), logger });

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Pocketverse API listening');
});

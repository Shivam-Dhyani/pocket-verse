import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';

const env = loadEnv();
const logger = createLogger({ pretty: env.NODE_ENV === 'development' });

// createApp fails fast on an unusable keyring — better than failing at first use.
const app = createApp({ env, prisma: getPrisma(), logger });

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Pocketverse API listening');
});

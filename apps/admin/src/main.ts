import { loadConfig } from '@botplatform/config';
import { createDatabase } from '@botplatform/database';
import { createLogger } from '@botplatform/logger';
import { buildAdminServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    name: 'admin',
    level: config.logLevel,
    pretty: config.nodeEnv === 'development',
  });

  const database = createDatabase(config.database.url);
  const app = await buildAdminServer({ config, db: database.db, logger });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'admin panel shutting down');
    try {
      await app.close();
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.admin.port, host: '0.0.0.0' });
  logger.info({ port: config.admin.port, url: config.admin.publicUrl }, 'admin panel listening');
}

main().catch((error) => {
  console.error('admin panel failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});

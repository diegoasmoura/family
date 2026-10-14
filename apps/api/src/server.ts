import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDb, migrate } from '@fin/db';
import { createApp } from './app';
import { loadConfig } from './config';
import { startDailyPush } from './modules/push';

const config = loadConfig();
if (config.databaseUrl.startsWith('sqlite:') && !config.databaseUrl.includes(':memory:')) {
  mkdirSync(dirname(config.databaseUrl.slice('sqlite:'.length)), { recursive: true });
}
const db = createDb(config.databaseUrl);

const applied = await migrate(db);
if (applied.length) console.log(`[api] migrations aplicadas: ${applied.join(', ')}`);
startDailyPush(db);

const server = createApp(db, config).listen(config.port, (error?: Error) => {
  if (error) {
    console.error(`[api] não foi possível usar a porta ${config.port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`[api] ouvindo na porta ${config.port} (${db.dialect})`);
});

const shutdown = () => {
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

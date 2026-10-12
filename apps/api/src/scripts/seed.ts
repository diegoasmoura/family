import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDb, migrate } from '@fin/db';
import { loadConfig } from '../config';
import { DEMO_PASSWORD, DEMO_USERS, seedDemo } from '../seed';

const config = loadConfig();
if (config.production && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Seed de demonstração bloqueado em produção (defina ALLOW_DEMO_SEED=true para forçar).');
  process.exit(1);
}
if (config.databaseUrl.startsWith('sqlite:')) mkdirSync(dirname(config.databaseUrl.slice('sqlite:'.length)), { recursive: true });
const db = createDb(config.databaseUrl);
await migrate(db);
const { created } = await seedDemo(db);
console.log(created ? `Demo criado. Logins: ${DEMO_USERS.join(', ')} / senha ${DEMO_PASSWORD}` : 'Demo já existia.');
await db.close();

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDb, migrate } from '@fin/db';
import { loadConfig } from '../config';

const config = loadConfig();
if (config.databaseUrl.startsWith('sqlite:')) mkdirSync(dirname(config.databaseUrl.slice('sqlite:'.length)), { recursive: true });
const db = createDb(config.databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado');
await db.close();

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

// One file = the whole database. DB_PATH lets Coolify point at a mounted volume.
const sqlite = new Database(env.DB_PATH || 'local.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle({ client: sqlite, schema });
export { schema };

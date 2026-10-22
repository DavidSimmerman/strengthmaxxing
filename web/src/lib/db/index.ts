import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

// One file = the whole database. DB_PATH lets Coolify point at a mounted volume.
// `vite build` loads route modules to analyse them; Coolify passes DB_PATH (/data/…) into the
// build too, where /data doesn't exist — so builds get a throwaway in-memory DB.
const path = building ? ':memory:' : env.DB_PATH || 'local.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const sqlite = new Database(path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle({ client: sqlite, schema });
export { schema };

import { loadConfig } from '../config.js';
import { openDb } from './client.js';

/** npm run db:migrate — applies everything in drizzle/ that the database hasn't seen yet. */
const config = loadConfig();
const h = await openDb(config.DATABASE_URL, { migrate: true });
await h.close();
console.log('migrations applied');

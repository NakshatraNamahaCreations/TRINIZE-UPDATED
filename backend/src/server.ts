import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { aiFrom } from './lib/ai.js';
import { sendDue } from './lib/comms.js';
import { sweep } from './lib/maintenance.js';
import { messengerFrom } from './lib/messenger.js';
import { smsFrom } from './lib/sms.js';

const config = loadConfig();
// pglite (no Postgres installed) migrates itself on start; real servers run `npm run db:migrate` in the deploy step
const handle = await openDb(config.DATABASE_URL, { migrate: config.DATABASE_URL.startsWith('pglite') });
const ai = aiFrom(config);
const messenger = messengerFrom(config);
const app = await buildApp({ config, db: handle.db, sms: smsFrom(config), ai, messenger });
app.log.info(ai.enabled ? `AI features on (answers: ${config.AI_MODEL}, moderation and rewrite: ${config.AI_MODEL_FAST || config.AI_MODEL})` : 'AI features on built-in rules (no OPENAI_API_KEY)');

// automatic follow-ups: vendor reminders after 24 quiet hours, escalation of overdue tickets
const followUps = setInterval(() => { sweep(handle.db).catch(e => app.log.error(e, 'follow-up sweep failed')); }, 10 * 60_000);
followUps.unref();
// scheduled messages go out within a minute of their time
const scheduled = setInterval(() => { sendDue(handle.db, messenger).catch(e => app.log.error(e, 'scheduled messages failed')); }, 60_000);
scheduled.unref();


const stop = async () => { await app.close(); await handle.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await app.listen({ port: config.PORT, host: '0.0.0.0' });

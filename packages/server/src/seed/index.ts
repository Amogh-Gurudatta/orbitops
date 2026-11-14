// `npm run seed`: connects, seeds demo data idempotently, disconnects.
import { loadConfig } from '../config.js';
import { connectDb, disconnectDb, ensureCollections } from '../db/index.js';
import { createLogger } from '../logger.js';
import { seedAll } from './bootstrap.js';

const config = loadConfig();
const log = createLogger(config);

try {
  await connectDb(config.mongoUri);
  await ensureCollections({ rawTtlHours: config.rawTtlHours });
  await seedAll({ deviceApiKey: config.deviceApiKey, log });
} finally {
  await disconnectDb();
}

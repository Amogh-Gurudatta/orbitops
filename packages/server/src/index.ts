// Process entry point: load config, start the server, shut down gracefully on SIGINT/SIGTERM.
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { startServer } from './server.js';

const config = loadConfig();
const log = createLogger(config);
for (const warning of config.warnings) log.warn(warning);

const server = await startServer(config, log);

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    const forced = setTimeout(() => {
      log.error('graceful shutdown timed out');
      process.exit(1);
    }, 15_000);
    forced.unref();
    server
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        log.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  });
}

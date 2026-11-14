// Optional embedded simulator: runs packages/simulator as a supervised child process of the server.
// Used on single-service hosts (e.g. Render's free tier, which has no free background workers) so a
// deployed demo has live data without a second service. It is still a separate OS process that
// connects to /ingest over Socket.IO with a device key, exactly like an external simulator would.
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { REPO_ROOT } from './paths.js';

const SIMULATOR_ENTRY = resolve(REPO_ROOT, 'packages/simulator/src/index.ts');
const TSX_BIN = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
const RESTART_DELAY_MS = 5_000;

export interface EmbeddedSimulator {
  stop(): Promise<void>;
}

export function startEmbeddedSimulator(opts: {
  port: number;
  deviceApiKey: string;
  hz: number;
  log: Logger;
}): EmbeddedSimulator {
  const log = opts.log.child({ component: 'embedded-simulator' });
  let child: ChildProcess | undefined;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | undefined;

  const launch = (): void => {
    child = spawn(TSX_BIN, [SIMULATOR_ENTRY], {
      cwd: resolve(REPO_ROOT, 'packages/simulator'),
      env: {
        ...process.env,
        SERVER_URL: `http://127.0.0.1:${opts.port}`,
        DEVICE_API_KEY: opts.deviceApiKey,
        SIM_HZ: String(opts.hz),
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    log.info({ pid: child.pid, hz: opts.hz }, 'embedded simulator started');
    child.once('exit', (code, signal) => {
      child = undefined;
      if (stopping) return;
      log.warn({ code, signal }, `embedded simulator exited; restarting in ${RESTART_DELAY_MS} ms`);
      restartTimer = setTimeout(launch, RESTART_DELAY_MS);
    });
  };

  launch();

  return {
    stop: () =>
      new Promise<void>((done) => {
        stopping = true;
        clearTimeout(restartTimer);
        if (!child) return done();
        const killTimer = setTimeout(() => child?.kill('SIGKILL'), 5_000);
        child.once('exit', () => {
          clearTimeout(killTimer);
          done();
        });
        child.kill('SIGTERM');
      }),
  };
}

// Integration-test harness: boots a real server (HTTP + Socket.IO) on an ephemeral port against a real
// MongoDB replica set. MongoDB comes from TEST_MONGODB_URI (e.g. the docker compose mongo) or an in-memory
// replica set (downloads a mongod binary on first use). Tests skip with a reason when neither is available.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { socketParser } from '@orbitops/shared';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { startServer, type RunningServer } from '../server.js';

export const DEVICE_KEY = 'integration-device-key';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

export const emitWithAck = <T>(socket: Socket, name: string, payload: unknown): Promise<T> =>
  socket.timeout(5000).emitWithAck(name, payload) as Promise<T>;

export interface ApiOptions {
  cookie?: string;
  method?: string;
  body?: unknown;
}

export function createHarness(env: Record<string, string> = {}) {
  let stopMemoryServer: (() => Promise<void>) | undefined;
  let unavailableReason: string | undefined;
  let server: RunningServer | undefined;
  let baseUrl = '';
  const sockets: Socket[] = [];

  async function resolveMongoUri(): Promise<string> {
    const dbName = `orbitops_it_${randomUUID().slice(0, 8)}`;
    const external = process.env.TEST_MONGODB_URI;
    if (external) {
      const url = new URL(external);
      url.pathname = `/${dbName}`;
      return url.toString();
    }
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    stopMemoryServer = () => replSet.stop().then(() => undefined);
    return replSet.getUri(dbName);
  }

  async function start(): Promise<void> {
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        PORT: '0',
        MONGODB_URI: await resolveMongoUri(),
        JWT_SECRET: 'integration-test-secret-0123456789abcdef',
        DEVICE_API_KEY: DEVICE_KEY,
        SEED_DEMO: 'true',
        PERSIST_HZ: '10',
        ...env,
      });
      server = await startServer(config, createLogger(config), { loginLimitPerMinute: 1000 });
      baseUrl = `http://127.0.0.1:${server.port}`;
    } catch (err) {
      unavailableReason = `MongoDB unavailable (set TEST_MONGODB_URI or allow mongodb-memory-server to download mongod): ${String(err)}`;
    }
  }

  async function stop(): Promise<void> {
    for (const socket of sockets) socket.close();
    if (server) {
      await mongoose.connection.dropDatabase();
      await server.stop();
    }
    await stopMemoryServer?.();
  }

  function open(namespace: string, extra: object = {}): Socket {
    const socket = connect(`${baseUrl}${namespace}`, {
      parser: socketParser,
      transports: ['websocket'],
      forceNew: true,
      ...extra,
    });
    sockets.push(socket);
    return socket;
  }

  /** Logs a demo user in and returns the cookie header to send with later requests. */
  async function login(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'orbitops' }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  /** JSON request to /api/v1; returns the status and parsed body (null for empty responses). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests probe response bodies loosely
  async function api<T = any>(path: string, options: ApiOptions = {}) {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  /** Registers a test that is skipped (with the reason) when MongoDB could not be provided. */
  const integration = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (unavailableReason) ctx.skip(unavailableReason);
      await fn();
    });

  return {
    start,
    stop,
    open,
    login,
    api,
    integration,
    get server(): RunningServer {
      if (!server) throw new Error('server not started');
      return server;
    },
    get baseUrl() {
      return baseUrl;
    },
  };
}

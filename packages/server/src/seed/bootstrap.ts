// Idempotent demo data: users, the bootstrap device key, the satellite catalogue and ground stations.
// Demo accounts: viewer@orbitops.dev / operator@orbitops.dev / admin@orbitops.dev, password "orbitops".
// DEMO ONLY - never enable SEED_DEMO on a deployment holding real operators.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SAT_GROUPS, ROLES, type Role } from '@orbitops/shared';
import { hashDeviceKey } from '../auth/deviceKey.js';
import { hashPassword } from '../auth/password.js';
import type { Logger } from '../logger.js';
import { Device, GroundStation, Satellite, User } from '../models/index.js';
import { DATA_DIR } from '../paths.js';

export const DEMO_PASSWORD = 'orbitops';

const SatellitesFile = z.object({
  satellites: z.array(
    z.object({
      noradId: z.int().min(0),
      name: z.string(),
      group: z.enum(SAT_GROUPS),
      line1: z.string(),
      line2: z.string(),
      epoch: z.string(),
    }),
  ),
});

const StationsFile = z.object({
  stations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      network: z.string(),
      lat: z.number(),
      lon: z.number(),
      altKm: z.number(),
      minElevDeg: z.number(),
    }),
  ),
});

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(DATA_DIR, file), 'utf8'));
}

export async function seedUsers(): Promise<number> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const demo: Role[] = [...ROLES];
  const result = await User.bulkWrite(
    demo.map((role) => ({
      updateOne: {
        filter: { email: `${role}@orbitops.dev` },
        update: {
          $setOnInsert: {
            email: `${role}@orbitops.dev`,
            name: `Demo ${role[0]?.toUpperCase()}${role.slice(1)}`,
            passwordHash,
            role,
          },
        },
        upsert: true,
      },
    })),
  );
  return result.upsertedCount;
}

export async function seedDevice(apiKey: string): Promise<boolean> {
  const result = await Device.updateOne(
    { keyHash: hashDeviceKey(apiKey) },
    { $setOnInsert: { name: 'bootstrap-simulator', allowedSources: ['*'] } },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

export async function seedSatellites(): Promise<number> {
  const { satellites } = SatellitesFile.parse(await readJson('satellites.json'));
  const result = await Satellite.bulkWrite(
    satellites.map(({ noradId, epoch, ...rest }) => ({
      updateOne: {
        filter: { satId: noradId },
        update: { $set: { satId: noradId, epoch: new Date(epoch), ...rest } },
        upsert: true,
      },
    })),
  );
  return result.upsertedCount;
}

export async function seedGroundStations(): Promise<number> {
  const { stations } = StationsFile.parse(await readJson('ground-stations.json'));
  const result = await GroundStation.bulkWrite(
    stations.map((station) => ({
      updateOne: {
        filter: { id: station.id },
        update: {
          $set: { ...station, loc: { type: 'Point', coordinates: [station.lon, station.lat] } },
        },
        upsert: true,
      },
    })),
  );
  return result.upsertedCount;
}

export interface SeedOptions {
  deviceApiKey?: string | undefined;
  log: Logger;
}

/** Seeds everything unconditionally (safe to repeat). Used by `npm run seed`. */
export async function seedAll({ deviceApiKey, log }: SeedOptions): Promise<void> {
  const users = await seedUsers();
  const device = deviceApiKey ? await seedDevice(deviceApiKey) : false;
  const sats = await seedSatellites();
  const stations = await seedGroundStations();
  log.info(
    { users, device, sats, stations },
    'seed complete (counts are newly inserted documents)',
  );
}

/** Boot-time variant: only fills collections that are completely empty, so admin edits are never touched. */
export async function bootstrapIfEmpty({ deviceApiKey, log }: SeedOptions): Promise<void> {
  const [users, sats, stations] = await Promise.all([
    User.estimatedDocumentCount(),
    Satellite.estimatedDocumentCount(),
    GroundStation.estimatedDocumentCount(),
  ]);
  if (users === 0) await seedUsers();
  if (sats === 0) await seedSatellites();
  if (stations === 0) await seedGroundStations();
  if (deviceApiKey) await seedDevice(deviceApiKey);
  log.info(
    { seededUsers: users === 0, seededSats: sats === 0, seededStations: stations === 0 },
    'demo bootstrap checked',
  );
}

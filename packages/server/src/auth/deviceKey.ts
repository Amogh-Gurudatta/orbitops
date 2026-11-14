// Device API keys: only sha256 hashes are stored; comparison is constant-time.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface DeviceIdentity {
  id: string;
  name: string;
  allowedSources: string[];
}

export interface StoredDevice extends DeviceIdentity {
  keyHash: string;
}

export type DeviceLookup = (keyHash: string) => Promise<StoredDevice | null>;

export const hashDeviceKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex');

export const generateDeviceKey = (): string => `oo_dev_${randomBytes(24).toString('base64url')}`;

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Resolves a presented API key to its device, or null. */
export async function authenticateDeviceKey(
  apiKey: unknown,
  lookup: DeviceLookup,
): Promise<DeviceIdentity | null> {
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 256) return null;
  const keyHash = hashDeviceKey(apiKey);
  const device = await lookup(keyHash);
  if (!device || !safeEqualHex(device.keyHash, keyHash)) return null;
  return { id: device.id, name: device.name, allowedSources: device.allowedSources };
}

/** A device may publish for a source when its allow-list has '*' or the exact source id. */
export const mayPublish = (device: DeviceIdentity, sourceId: string): boolean =>
  device.allowedSources.includes('*') || device.allowedSources.includes(sourceId);

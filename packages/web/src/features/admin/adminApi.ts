// REST helpers for the admin page: operator accounts and ingest device keys.
import type { Role } from '@orbitops/shared';
import { api } from '../../api/client.ts';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface DeviceRecord {
  id: string;
  name: string;
  allowedSources: string[];
  /** Epoch ms. */
  lastSeenAt?: number;
  createdAt?: number;
}

export const adminKeys = {
  users: ['admin', 'users'] as const,
  devices: ['admin', 'devices'] as const,
};

export const fetchUsers = () => api.get<{ users: UserRecord[] }>('/users').then((r) => r.users);

export interface NewUser {
  email: string;
  name: string;
  password: string;
  role: Role;
}
export const createUser = (user: NewUser) =>
  api.post<{ user: UserRecord }>('/users', user).then((r) => r.user);

export const updateUserRole = (id: string, role: Role) =>
  api.patch<{ user: UserRecord }>(`/users/${encodeURIComponent(id)}`, { role }).then((r) => r.user);

export const fetchDevices = () =>
  api.get<{ devices: DeviceRecord[] }>('/devices').then((r) => r.devices);

/** The plaintext `key` is returned only here, once. */
export const createDevice = (name: string, allowedSources: string[]) =>
  api.post<{ device: DeviceRecord; key: string }>('/devices', { name, allowedSources });

export const deleteDevice = (id: string) => api.delete<void>(`/devices/${encodeURIComponent(id)}`);

/** Server error codes worth explaining in the UI's own words. */
const MESSAGES: Record<string, string> = {
  email_taken: 'EMAIL ALREADY REGISTERED',
  cannot_change_own_role: 'YOU CANNOT CHANGE YOUR OWN ROLE',
  user_not_found: 'USER NO LONGER EXISTS',
  device_not_found: 'DEVICE NO LONGER EXISTS',
  forbidden: 'ADMIN AUTHORITY REQUIRED',
};

export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'REQUEST FAILED';
  return MESSAGES[raw] ?? raw.replaceAll('_', ' ').toUpperCase();
}

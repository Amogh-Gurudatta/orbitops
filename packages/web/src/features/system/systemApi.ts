// REST helpers for the system page: the ingest chaos switch.
import type { ChaosConfig } from '@orbitops/shared';
import { api } from '../../api/client.ts';

export const systemKeys = { chaos: ['system', 'chaos'] as const };

export const fetchChaos = () =>
  api.get<{ chaos: ChaosConfig }>('/system/chaos').then((r) => r.chaos);

export const updateChaos = (chaos: ChaosConfig) =>
  api.put<{ chaos: ChaosConfig }>('/system/chaos', chaos).then((r) => r.chaos);

/** UI cap for the rate sliders; the server accepts up to 1 but 30 % is already extreme. */
export const MAX_CHAOS_RATE = 0.3;

// Ack / resolve actions for the alarm list, including "ACK ALL VISIBLE" with bounded concurrency.
import { useCallback, useState } from 'react';
import type { Alert } from '@orbitops/shared';
import { useSession } from '../../auth/AuthContext.tsx';
import { ackAlert, resolveAlert } from './alertsApi.ts';
import { usePatchAlertCache } from './useAlertFeed.ts';
import { runPool } from './pool.ts';

const BULK_CONCURRENCY = 4;

export function useAlertActions() {
  const { can } = useSession();
  const patchCache = usePatchAlertCache();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = useCallback(
    async (action: (id: string) => Promise<Alert>, alert: Alert) => {
      setError(null);
      try {
        patchCache(await action(alert.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ACTION FAILED');
      }
    },
    [patchCache],
  );

  const ack = useCallback((alert: Alert) => run(ackAlert, alert), [run]);
  const resolve = useCallback((alert: Alert) => run(resolveAlert, alert), [run]);

  const ackMany = useCallback(
    async (alerts: readonly Alert[]) => {
      setError(null);
      setProgress({ done: 0, total: alerts.length });
      const result = await runPool(
        alerts,
        BULK_CONCURRENCY,
        async (alert) => patchCache(await ackAlert(alert.id)),
        (p) => setProgress({ done: p.done + p.failed, total: alerts.length }),
      );
      setProgress(null);
      if (result.failed > 0) setError(`${result.failed} OF ${alerts.length} NOT ACKNOWLEDGED`);
    },
    [patchCache],
  );

  return { canAct: can('operator'), ack, resolve, ackMany, error, progress };
}

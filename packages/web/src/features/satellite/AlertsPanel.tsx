// Alerts for this satellite from the shared alerts store (fed by the alerts:all socket room), newest
// first. Operators and admins can acknowledge and resolve.
import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Alert } from '@orbitops/shared';
import { useSession } from '../../auth/AuthContext.tsx';
import { cx } from '../../lib/cx.ts';
import { useAlertsStore } from '../../realtime/alertsStore.ts';
import {
  Button,
  EmptyState,
  Panel,
  SeverityChip,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../ui/index.ts';
import { useNow } from './hooks.ts';
import { formatClock } from './passes.ts';
import { ackAlertById, resolveAlertById } from './satelliteApi.ts';

const LIST_CAP = 40;

function ageOf(alert: Alert, now: number): string {
  return formatClock(now - alert.openedAt);
}

function AlertActions({ alert }: { alert: Alert }) {
  const upsert = useAlertsStore((s) => s.upsert);
  const ack = useMutation({ mutationFn: ackAlertById, onSuccess: upsert });
  const resolve = useMutation({ mutationFn: resolveAlertById, onSuccess: upsert });
  if (alert.state === 'resolved') return null;
  return (
    <span className="inline-flex gap-0.5">
      {alert.state === 'open' && (
        <Button
          size="sm"
          className="h-2"
          disabled={ack.isPending}
          onClick={() => ack.mutate(alert.id)}
        >
          ACK
        </Button>
      )}
      <Button
        size="sm"
        className="h-2"
        disabled={resolve.isPending}
        onClick={() => resolve.mutate(alert.id)}
      >
        RESOLVE
      </Button>
      {(ack.isError || resolve.isError) && (
        <span className="mnemonic text-2xs text-warning">FAILED</span>
      )}
    </span>
  );
}

export function AlertsPanel({ satId }: { satId: number }) {
  const { can } = useSession();
  const alerts = useAlertsStore((s) => s.alerts);
  const now = useNow(1000);
  const rows = useMemo(() => {
    const mine = alerts.filter((a) => a.satId === satId);
    // Unresolved first (store order is newest first), then recent history.
    return [
      ...mine.filter((a) => a.state !== 'resolved'),
      ...mine.filter((a) => a.state === 'resolved'),
    ].slice(0, LIST_CAP);
  }, [alerts, satId]);
  const unresolved = rows.filter((a) => a.state !== 'resolved').length;
  const operator = can('operator');

  return (
    <Panel title="ALERTS" subtitle={`${unresolved} ACTIVE`} state={undefined} flush>
      {rows.length === 0 ? (
        <EmptyState title="NO ALERTS" detail="No alerts recorded for this satellite." />
      ) : (
        <div className="h-full overflow-auto">
          <Table>
            <THead>
              <tr>
                <TH>SEV</TH>
                <TH>SYS</TH>
                <TH className="w-full">MESSAGE</TH>
                <TH numeric>AGE</TH>
                {operator && <TH />}
              </tr>
            </THead>
            <TBody>
              {rows.map((alert) => (
                <TR
                  key={alert.id}
                  state={
                    alert.state === 'resolved'
                      ? undefined
                      : alert.severity === 'WARNING'
                        ? 'warning'
                        : alert.severity === 'CAUTION'
                          ? 'caution'
                          : undefined
                  }
                  className={cx(alert.state === 'resolved' && 'text-text-dim')}
                >
                  <TD>
                    <span
                      className={cx(alert.state === 'open' && 'blink-1hz')}
                      data-unacked={alert.state === 'open'}
                    >
                      <SeverityChip severity={alert.severity} />
                    </span>
                  </TD>
                  <TD>
                    <span className="mnemonic text-xs">{alert.subsystem}</span>
                  </TD>
                  <TD className="w-full max-w-0" title={alert.message}>
                    {alert.message}
                    {alert.count > 1 && (
                      <span className="num ml-0.5 text-2xs text-text-dim">x{alert.count}</span>
                    )}
                  </TD>
                  <TD numeric>{ageOf(alert, now)}</TD>
                  {operator && (
                    <TD className="overflow-visible text-right">
                      <AlertActions alert={alert} />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

// Latest alarms, newest first. Unacknowledged rows blink their severity chip at 1 Hz (ISA-18.2); operators and
// above can acknowledge inline. Full filtering lives on the Alerts page.
import { memo, useState } from 'react';
import { Link } from 'react-router';
import type { Alert } from '@orbitops/shared';
import { ackAlert } from '../../api/endpoints.ts';
import { useSession } from '../../auth/AuthContext.tsx';
import { cx } from '../../lib/cx.ts';
import { useAlertsStore } from '../../realtime/alertsStore.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { Button, SeverityChip, TBody, TD, TH, THead, TR } from '../../ui/index.ts';

const MAX_ROWS = 100;
const STATE_CODE: Record<Alert['state'], string> = {
  open: 'OPEN',
  acked: 'ACKED',
  resolved: 'RES',
};

export const utcClock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

const AlarmRow = memo(function AlarmRow({
  alert,
  satName,
  canAck,
  onSelectSat,
}: {
  alert: Alert;
  satName: string;
  canAck: boolean;
  onSelectSat(satId: number): void;
}) {
  const [busy, setBusy] = useState(false);
  const unacked = alert.state === 'open';

  const ack = async () => {
    setBusy(true);
    try {
      useAlertsStore.getState().upsert(await ackAlert(alert.id));
    } catch {
      // The row stays unacknowledged and the button re-enables; the socket feed corrects any drift.
    } finally {
      setBusy(false);
    }
  };

  return (
    <TR
      className={cx(alert.state === 'resolved' && 'text-text-dim')}
      onClick={() => onSelectSat(alert.satId)}
    >
      <TD numeric className="text-text-2">
        {utcClock(alert.openedAt)}
      </TD>
      <TD>
        <span
          data-unacked={unacked}
          className={unacked ? 'blink-1hz inline-block' : 'inline-block'}
        >
          <SeverityChip severity={alert.severity} />
        </span>
      </TD>
      <TD className="truncate">{satName}</TD>
      <TD className="mnemonic text-xs text-text-2">{alert.subsystem}</TD>
      <TD className="truncate" title={alert.message}>
        {alert.message}
      </TD>
      <TD className="mnemonic text-xs">
        {canAck && unacked ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-2 px-0.5"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void ack();
            }}
          >
            ACK
          </Button>
        ) : (
          <span className={unacked ? 'text-text' : 'text-text-dim'}>{STATE_CODE[alert.state]}</span>
        )}
      </TD>
    </TR>
  );
});

export function AlarmLog({ onSelectSat }: { onSelectSat(satId: number): void }) {
  const alerts = useAlertsStore((s) => s.alerts);
  const catalog = useFleetStore((s) => s.catalog);
  const { can } = useSession();
  const canAck = can('operator');
  const rows = alerts.slice(0, MAX_ROWS);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[480px] table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col style={{ width: 80 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 144 }} />
            <col style={{ width: 56 }} />
            <col />
            <col style={{ width: 64 }} />
          </colgroup>
          <THead>
            <tr>
              <TH>TIME</TH>
              <TH>SEV</TH>
              <TH>SAT</TH>
              <TH>SUBSYS</TH>
              <TH>MESSAGE</TH>
              <TH>STATE</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((alert) => (
              <AlarmRow
                key={alert.id}
                alert={alert}
                satName={catalog[alert.satId]?.name ?? String(alert.satId)}
                canAck={canAck}
                onSelectSat={onSelectSat}
              />
            ))}
          </TBody>
        </table>
        {rows.length === 0 && <p className="mnemonic p-1 text-xs text-text-2">NO ACTIVE ALARMS</p>}
      </div>
      <div className="flex h-3 shrink-0 items-center justify-between border-t border-rule px-1">
        <span className="num text-xs text-text-dim">
          {rows.length}/{alerts.length}
        </span>
        <Link to="/alerts" className="mnemonic text-xs text-text-2 hover:text-text">
          ALL ALERTS ▸
        </Link>
      </div>
    </div>
  );
}

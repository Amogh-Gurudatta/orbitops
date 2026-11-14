// Detail pane for the selected alarm: full record, context chart and ACK / RESOLVE.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Alert, AlertRule } from '@orbitops/shared';
import { formatUtcFull } from '../../lib/formatTime.ts';
import { Button, EmptyState, Panel, SeverityChip, Tooltip } from '../../ui/index.ts';
import { AlertContextChart } from './AlertContextChart.tsx';
import { metricForRule } from './ruleMetric.ts';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-3 grid-cols-[80px_minmax(0,1fr)] items-baseline gap-x-1 border-b border-grid px-1 py-px">
      <dt className="mnemonic text-xs text-text-dim">{label}</dt>
      <dd className="num min-w-0 break-words text-xs text-text">{children}</dd>
    </div>
  );
}

const when = (ms: number | undefined) => (ms === undefined ? '—' : `${formatUtcFull(ms)}Z`);

export interface AlertDetailProps {
  alert: Alert | null;
  rule: AlertRule | undefined;
  satName: string | undefined;
  canAct: boolean;
  onAck(alert: Alert): void;
  onResolve(alert: Alert): void;
}

export function AlertDetail({ alert, rule, satName, canAct, onAck, onResolve }: AlertDetailProps) {
  if (!alert) {
    return (
      <Panel title="ALARM DETAIL">
        <EmptyState
          title="NO ALARM SELECTED"
          detail="Select a row, or use J / K to move through the list."
        />
      </Panel>
    );
  }
  const metric = metricForRule(alert.ruleId, alert.subsystem);
  const resolved = alert.state === 'resolved';
  return (
    <Panel
      title="ALARM DETAIL"
      subtitle={<SeverityChip severity={alert.severity} />}
      flush
      bodyClassName="flex min-h-0 flex-col overflow-auto"
    >
      <dl className="shrink-0">
        <Row label="SATELLITE">
          <Link to={`/sat/${alert.satId}`} className="hover:underline">
            {satName ?? 'UNKNOWN'} {alert.satId}
          </Link>
        </Row>
        <Row label="RULE">
          {rule?.name ?? alert.ruleId} <span className="text-text-dim">{alert.ruleId}</span>
        </Row>
        <Row label="SUBSYS">{alert.subsystem}</Row>
        <Row label="STATE">{alert.state.toUpperCase()}</Row>
        <Row label="MESSAGE">
          <span className="font-sans">{alert.message}</span>
        </Row>
        <Row label="VALUE / LIMIT">
          {alert.value === null ? '—' : alert.value.toPrecision(4)}
          <span className="text-text-dim"> / {alert.threshold ?? '—'}</span>
        </Row>
        <Row label="OPENED">{when(alert.openedAt)}</Row>
        <Row label="LAST SEEN">{when(alert.lastSeenAt)}</Row>
        <Row label="COUNT">{alert.count}</Row>
        <Row label="ACKED">
          {alert.ackedBy ?? '—'}{' '}
          {alert.ackedAt !== undefined && (
            <span className="text-text-dim">{when(alert.ackedAt)}</span>
          )}
        </Row>
        <Row label="RESOLVED">{when(alert.resolvedAt)}</Row>
        <Row label="ALERT ID">
          <span className="text-text-2">{alert.id}</span>
        </Row>
      </dl>

      <div className="flex shrink-0 items-center gap-1 border-b border-rule p-1">
        <AuthorityGate allowed={canAct}>
          <Button
            size="sm"
            variant="primary"
            disabled={!canAct || alert.state !== 'open'}
            onClick={() => onAck(alert)}
            hint={<span className="text-text-dim">A</span>}
          >
            ACK
          </Button>
        </AuthorityGate>
        <AuthorityGate allowed={canAct}>
          <Button
            size="sm"
            disabled={!canAct || resolved}
            onClick={() => onResolve(alert)}
            hint={<span className="text-text-dim">R</span>}
          >
            RESOLVE
          </Button>
        </AuthorityGate>
      </div>

      <div className="min-h-32 flex-1 p-1">
        {metric ? (
          <AlertContextChart alert={alert} metric={metric} rule={rule} />
        ) : (
          <EmptyState
            title="NO RELATED METRIC"
            detail="This rule watches data freshness, not a measured value."
          />
        )}
      </div>
    </Panel>
  );
}

/** Viewers see the control disabled with the reason on hover. */
function AuthorityGate({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  if (allowed) return children;
  return (
    <Tooltip content="OPERATOR AUTHORITY REQUIRED">
      <span tabIndex={0} className="inline-block">
        {children}
      </span>
    </Tooltip>
  );
}

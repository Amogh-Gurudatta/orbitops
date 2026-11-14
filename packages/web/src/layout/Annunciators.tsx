// Master WARNING / CAUTION lamps and the subsystem annunciator strip, rolled up from unacknowledged alerts.
// Lamp colour = worst active severity; flashing = something unacknowledged; steady = acknowledged but active.
import { useNavigate } from 'react-router';
import { SUBSYSTEMS, type Severity } from '@orbitops/shared';
import { useAlertsStore } from '../realtime/alertsStore.ts';
import { Lamp } from '../ui/index.ts';

export function MasterLamps() {
  const navigate = useNavigate();
  const severity = useAlertsStore((s) => s.summary.severity);
  const lamp = (level: Severity, label: string) => {
    const { unacked, acked } = severity[level];
    return (
      <Lamp
        key={level}
        label={label}
        severity={unacked + acked > 0 ? level : null}
        unacked={unacked > 0}
        count={unacked}
        title={`${unacked} unacknowledged, ${acked} acknowledged`}
        onClick={() => navigate(`/alerts?severity=${level}`)}
        className="min-w-12"
      />
    );
  };
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Master alerts">
      {lamp('WARNING', 'WARNING')}
      {lamp('CAUTION', 'CAUTION')}
    </div>
  );
}

export function SubsystemStrip() {
  const navigate = useNavigate();
  const subsystem = useAlertsStore((s) => s.summary.subsystem);
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Subsystem annunciators">
      {SUBSYSTEMS.map((name) => {
        const sub = subsystem[name];
        return (
          <Lamp
            key={name}
            label={name}
            severity={sub.worst}
            unacked={sub.unacked > 0}
            title={`${sub.active} active, ${sub.unacked} unacknowledged`}
            onClick={() => navigate(`/alerts?subsystem=${name}`)}
          />
        );
      })}
    </div>
  );
}

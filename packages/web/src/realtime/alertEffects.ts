// Side effects of incoming alerts: store update, restyled toast and optional sound.
import { createElement } from 'react';
import { toast } from 'sonner';
import type { Alert } from '@orbitops/shared';
import { alertSound } from './alertSound.ts';
import { useAlertsStore } from './alertsStore.ts';
import { useFleetStore } from './fleetStore.ts';

const TONE_CLASS: Record<Alert['severity'], string> = {
  WARNING: 'text-warning',
  CAUTION: 'text-caution',
  ADVISORY: 'text-advisory',
};

/** Handles ALERT (isNew = true) and ALERT_UPDATE (false) messages from the worker. */
export function handleIncomingAlert(alert: Alert, isNew: boolean): void {
  const wasUnknown = useAlertsStore.getState().upsert(alert);
  alertSound.syncUnackedWarnings(useAlertsStore.getState().summary.severity.WARNING.unacked);
  if (!isNew || !wasUnknown || alert.state !== 'open' || alert.severity === 'ADVISORY') return;

  alertSound.announce(alert.severity);
  const sat = useFleetStore.getState().catalog[alert.satId];
  toast.custom(
    () =>
      createElement(
        'div',
        { className: 'oo-toast', 'data-sev': alert.severity, role: 'alert' },
        createElement(
          'span',
          { className: `mnemonic text-sm ${TONE_CLASS[alert.severity]}` },
          alert.severity,
        ),
        createElement(
          'div',
          { className: 'min-w-0 flex-1' },
          createElement(
            'div',
            { className: 'mnemonic text-text-2' },
            `${alert.subsystem} // ${sat?.name ?? alert.satId}`,
          ),
          createElement('div', { className: 'mt-0.5 text-text' }, alert.message),
        ),
      ),
    { id: alert.id, duration: alert.severity === 'WARNING' ? 12_000 : 6_000 },
  );
}

export function setSoundEnabled(on: boolean): void {
  alertSound.setEnabled(on);
  useAlertsStore.getState().setSoundEnabled(on);
  alertSound.syncUnackedWarnings(useAlertsStore.getState().summary.severity.WARNING.unacked);
}

// Zustand store for alerts: recent list (capped), roll-up counts per severity / subsystem / satellite
// and the sound toggle. Fed by worker ALERT / ALERT_UPDATE messages via alertEffects.ts.
import { create } from 'zustand';
import type { Alert } from '@orbitops/shared';
import { ALERT_LIST_CAP } from '../config.ts';
import { summarizeAlerts, type AlertSummary } from './alertSummary.ts';

interface AlertsState {
  /** Most recently seen first, capped at ALERT_LIST_CAP. */
  alerts: Alert[];
  summary: AlertSummary;
  soundEnabled: boolean;
  /** Inserts or replaces by id. Returns true when the alert was not known before. */
  upsert(alert: Alert): boolean;
  replaceAll(alerts: readonly Alert[]): void;
  setSoundEnabled(on: boolean): void;
  reset(): void;
}

const EMPTY_SUMMARY = summarizeAlerts([]);

function normalise(alerts: Alert[]): Alert[] {
  return alerts.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, ALERT_LIST_CAP);
}

export const useAlertsStore = create<AlertsState>()((set, get) => ({
  alerts: [],
  summary: EMPTY_SUMMARY,
  soundEnabled: false,
  upsert(alert) {
    const existing = get().alerts;
    const isNew = !existing.some((a) => a.id === alert.id);
    const alerts = normalise([alert, ...existing.filter((a) => a.id !== alert.id)]);
    set({ alerts, summary: summarizeAlerts(alerts) });
    return isNew;
  },
  replaceAll(incoming) {
    const alerts = normalise([...incoming]);
    set({ alerts, summary: summarizeAlerts(alerts) });
  },
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  reset: () => set({ alerts: [], summary: EMPTY_SUMMARY }),
}));

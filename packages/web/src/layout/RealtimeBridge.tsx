// Starts the realtime layer for the signed-in shell: spawns the socket worker, holds the always-on
// subscriptions (fleet summary + alert feed), loads the satellite catalogue and open alerts over REST,
// and runs the status sweeper. Renders nothing.
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ALERTS_ALL_ROOM, FLEET_ROOM } from '@orbitops/shared';
import { fetchOpenAlerts, fetchSatellites, queryKeys } from '../api/endpoints.ts';
import { realtime } from '../realtime/client.ts';
import { useAlertsStore } from '../realtime/alertsStore.ts';
import { startStatusSweeper, useFleetStore } from '../realtime/fleetStore.ts';

export function RealtimeBridge() {
  const catalog = useQuery({
    queryKey: queryKeys.satellites,
    queryFn: fetchSatellites,
    staleTime: 5 * 60_000,
  });
  const alerts = useQuery({
    queryKey: ['alerts', 'open-bootstrap'],
    queryFn: fetchOpenAlerts,
    staleTime: Infinity,
  });

  useEffect(() => {
    realtime.start();
    const releaseFleet = realtime.acquire([FLEET_ROOM], 1);
    const releaseAlerts = realtime.acquire([ALERTS_ALL_ROOM], 1);
    const stopSweeper = startStatusSweeper();
    return () => {
      releaseFleet();
      releaseAlerts();
      stopSweeper();
      realtime.stop();
    };
  }, []);

  useEffect(() => {
    if (catalog.data) useFleetStore.getState().setCatalog(catalog.data);
  }, [catalog.data]);

  useEffect(() => {
    if (alerts.data) useAlertsStore.getState().replaceAll(alerts.data);
  }, [alerts.data]);

  return null;
}

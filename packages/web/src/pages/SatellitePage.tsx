// /sat/:satId (detail) and /sat (picker). Detail is keyed by satellite so charts and subscriptions reset on switch.
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { SatellitePicker } from '../features/satellite/SatellitePicker.tsx';
import { SatelliteView } from '../features/satellite/SatelliteView.tsx';
import { EmptyState, LoadingState, Panel } from '../ui/index.ts';

export function Component() {
  const { satId } = useParams();
  const id = satId === undefined ? null : Number(satId);
  const catalog = useFleetStore((s) => s.catalog);
  const selectSat = useFleetStore((s) => s.selectSat);
  const satellite = id === null ? undefined : catalog[id];

  // The nav rail's SAT entry returns to the satellite last viewed.
  useEffect(() => {
    if (satellite) selectSat(satellite.satId);
  }, [satellite, selectSat]);

  if (id === null) return <SatellitePicker />;
  if (!satellite) {
    return Object.keys(catalog).length === 0 ? (
      <Panel title="SAT" subtitle={satId}>
        <LoadingState label="LOADING CATALOGUE" />
      </Panel>
    ) : (
      <Panel title="SAT" subtitle={satId}>
        <EmptyState
          title="UNKNOWN SATELLITE"
          detail={`No satellite with NORAD id ${satId} in the catalogue. Use Ctrl+K to search.`}
        />
      </Panel>
    );
  }
  return <SatelliteView key={satellite.satId} satellite={satellite} />;
}

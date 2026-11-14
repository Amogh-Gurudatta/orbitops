// Satellite detail view for one satellite: header strip and the subsystem panel grid.
// Subscribes to the satellite's room at 10 Hz for as long as it is mounted.
import { useState } from 'react';
import { satRoom } from '@orbitops/shared';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { useSubscription } from '../../realtime/useRealtime.ts';
import type { Satellite } from '../../api/types.ts';
import { AlertsPanel } from './AlertsPanel.tsx';
import { CommandsPanel } from './CommandsPanel.tsx';
import { OrbitPanel } from './OrbitPanel.tsx';
import { PassesPanel } from './PassesPanel.tsx';
import { SatelliteHeader } from './SatelliteHeader.tsx';
import { AdcsPanel, CommPanel, EpsPanel, TcsPanel } from './SubsystemPanels.tsx';
import { DEFAULT_RANGE, rangeById, type RangeId } from './ranges.ts';
import { useSatHistory } from './useSatHistory.ts';
import { useSeamDiagnostics } from './useSeamDiagnostics.ts';

/** Chart width used to size history requests (the grid shows four columns on wide screens). */
const CHART_WIDTH_PX = 360;

export function SatelliteView({ satellite }: { satellite: Satellite }) {
  const { satId } = satellite;
  const [rangeId, setRangeId] = useState<RangeId>(DEFAULT_RANGE);
  const range = rangeById(rangeId);
  useSubscription([satRoom(satId)], 10);

  const history = useSatHistory(satId, range, CHART_WIDTH_PX);
  const diagnostics = useSeamDiagnostics(satId);
  const stale = useFleetStore((s) => s.status[satId] === 'STALE');
  const panel = { satId, range, history, stale };

  return (
    <div className="flex min-h-full flex-col gap-1">
      <SatelliteHeader
        satellite={satellite}
        rangeId={rangeId}
        onRangeChange={setRangeId}
        history={history}
        diagnostics={diagnostics}
      />
      <div className="grid min-h-[760px] flex-1 auto-rows-[minmax(320px,auto)] grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-4 xl:grid-rows-[minmax(0,3fr)_minmax(0,2fr)]">
        <EpsPanel {...panel} />
        <TcsPanel {...panel} />
        <CommPanel {...panel} />
        <AdcsPanel {...panel} />
        <OrbitPanel satId={satId} stale={stale} />
        <PassesPanel satId={satId} />
        <AlertsPanel satId={satId} />
        <CommandsPanel satId={satId} satName={satellite.name} />
      </div>
    </div>
  );
}

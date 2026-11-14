// ORBIT panel: position readouts plus a small globe centred on this satellite with its ground track.
import { useLatest } from '../../realtime/useRealtime.ts';
import { Panel, Readout } from '../../ui/index.ts';
import { GlobeSlot } from './GlobeSlot.tsx';

export function OrbitPanel({ satId, stale }: { satId: number; stale: boolean }) {
  const v = useLatest(satId, ['lat', 'lon', 'altKm', 'velKms'], 5);
  const state = stale ? 'stale' : 'nominal';
  return (
    <Panel title="ORBIT" subtitle="GROUND TRACK" flush bodyClassName="flex flex-col">
      <Readout label="LAT" value={v.lat} unit="deg" decimals={2} state={state} />
      <Readout label="LON" value={v.lon} unit="deg" decimals={2} state={state} />
      <Readout label="ALT" value={v.altKm} unit="km" decimals={1} state={state} />
      <Readout label="VEL" value={v.velKms} unit="km/s" decimals={2} state={state} />
      <div className="relative min-h-[160px] flex-1 border-t border-rule">
        <GlobeSlot
          mode="live"
          selectedSatId={satId}
          showGroundTracks
          showStations
          className="absolute inset-0"
        />
      </div>
    </Panel>
  );
}

// Ground Stations (/stations): station list, globe with coverage footprints, and the pass Gantt for the
// selected station. Panels are a fixed CSS grid (no drag layout) so the Gantt always gets the full width.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchStations, queryKeys } from '../api/endpoints.ts';
import { Globe } from '../features/globe/Globe.tsx';
import { PassTimeline } from '../features/stations/PassTimeline.tsx';
import { nextAosByStation, StationTable } from '../features/stations/StationTable.tsx';
import { useFleetPasses, useInViewCounts, useNow } from '../features/stations/useStationData.ts';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { EmptyState, ErrorState, LoadingState, Panel } from '../ui/index.ts';

export function Component() {
  const navigate = useNavigate();
  const stationsQuery = useQuery({
    queryKey: queryKeys.stations,
    queryFn: fetchStations,
    staleTime: 10 * 60_000,
  });
  const stations = stationsQuery.data;
  const [stationId, setStationId] = useState<string | null>(null);
  const selectedSatId = useFleetStore((s) => s.selectedSatId);
  const selectSat = useFleetStore((s) => s.selectSat);

  useEffect(() => {
    if (stations && stations.length > 0 && stationId === null) setStationId(stations[0]!.id);
  }, [stations, stationId]);

  const now = useNow(1000);
  const timelineNow = useNow(10_000);
  const fleetPasses = useFleetPasses();
  const inView = useInViewCounts(stations);
  const nextAos = useMemo(
    () => nextAosByStation(fleetPasses.passes, now),
    [fleetPasses.passes, now],
  );
  const stationPasses = useMemo(
    () => fleetPasses.passes.filter((p) => p.stationId === stationId),
    [fleetPasses.passes, stationId],
  );
  const station = stations?.find((s) => s.id === stationId);
  const acquiring = fleetPasses.total === 0 || fleetPasses.settled < fleetPasses.total;

  return (
    <div className="grid h-full min-h-[640px] grid-cols-1 grid-rows-[minmax(240px,1fr)_minmax(240px,1fr)] gap-1 lg:grid-cols-[minmax(480px,5fr)_7fr]">
      <Panel title="STATIONS" subtitle={stations ? `${stations.length} SITES` : undefined} flush>
        {stationsQuery.isError ? (
          <ErrorState error={stationsQuery.error} onRetry={() => void stationsQuery.refetch()} />
        ) : !stations ? (
          <LoadingState label="ACQUIRING STATIONS" />
        ) : (
          <StationTable
            stations={stations}
            selectedId={stationId}
            inView={inView}
            nextAos={nextAos}
            now={now}
            onSelect={setStationId}
          />
        )}
      </Panel>

      <Panel
        title="COVERAGE"
        subtitle={station ? `${station.id} · ${station.name}` : '550 KM LEO FOOTPRINT'}
        flush
      >
        <Globe
          mode="live"
          selectedSatId={selectedSatId}
          onSelectSat={selectSat}
          onOpenSat={(satId) => navigate(`/sat/${satId}`)}
          showStations
          showCoverage
          showGroundTracks={false}
          highlightStationId={stationId ?? undefined}
          onSelectStation={setStationId}
        />
      </Panel>

      <Panel
        title="PASS TIMELINE"
        subtitle={
          station
            ? `${station.id} · NEXT 12 H · ${stationPasses.length} PASSES${
                acquiring ? ` · ACQUIRING ${fleetPasses.settled}/${fleetPasses.total}` : ''
              }`
            : undefined
        }
        className="lg:col-span-2"
        flush
      >
        {!station ? (
          <EmptyState
            title="NO STATION SELECTED"
            detail="Select a ground station to see its passes."
          />
        ) : fleetPasses.total > 0 && fleetPasses.failed === fleetPasses.total ? (
          <ErrorState title="PASS DATA UNAVAILABLE" error="Pass predictions could not be loaded." />
        ) : stationPasses.length === 0 && acquiring ? (
          <LoadingState label="ACQUIRING PASS PREDICTIONS" />
        ) : stationPasses.length === 0 ? (
          <EmptyState
            title="NO PASSES"
            detail="No satellite rises above this station's minimum elevation in the next 12 hours."
          />
        ) : (
          <PassTimeline
            passes={stationPasses}
            now={timelineNow}
            selectedSatId={selectedSatId}
            onSelectSat={selectSat}
          />
        )}
      </Panel>
    </div>
  );
}

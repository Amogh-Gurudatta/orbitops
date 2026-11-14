// Replay: a time machine over the last 6 hours. The timeline drives the globe (positions propagated
// client-side from TLEs) and the telemetry charts (history fetched once per satellite). While mounted
// the app is in REPLAY mode; live subscriptions are left untouched and mode returns to live on exit.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { serverNow } from '../../realtime/clock.ts';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  SegmentedControl,
  Select,
} from '../../ui/index.ts';
import { GlobeSlot } from '../satellite/GlobeSlot.tsx';
import { formatClock } from '../satellite/passes.ts';
import { ReplayCharts, ReplayReadouts } from './ReplayCharts.tsx';
import { Timeline } from './Timeline.tsx';
import { Transport } from './Transport.tsx';
import { HOUR_MS, MINUTE_MS, type TimeSpan } from './timeline.ts';
import { useAlertMarkers, useReplayHistory } from './useReplayData.ts';
import { usePlayback } from './usePlayback.ts';

const REPLAY_WINDOW_MS = 6 * HOUR_MS;
const START_BEFORE_END_MS = 10 * MINUTE_MS;
const FALLBACK_SAT = 25544;

const CHART_WINDOWS = [
  { value: String(15 * MINUTE_MS), label: '15M' },
  { value: String(HOUR_MS), label: '1H' },
  { value: String(3 * HOUR_MS), label: '3H' },
];

/** Window = the last 6 h up to the moment replay was opened. */
function initialSpan(): TimeSpan {
  const to = Math.round(serverNow());
  return { from: to - REPLAY_WINDOW_MS, to };
}

export function ReplayView() {
  const navigate = useNavigate();
  const [span] = useState(initialSpan);
  const catalog = useFleetStore((s) => s.catalog);
  const selectedSatId = useFleetStore((s) => s.selectedSatId);
  const selectSat = useFleetStore((s) => s.selectSat);
  const [chartWindowMs, setChartWindowMs] = useState(String(HOUR_MS));

  const satId = selectedSatId ?? FALLBACK_SAT;
  const satName = catalog[satId]?.name ?? String(satId);

  // REPLAY mode for the lifetime of the page; always restore live on the way out.
  useEffect(() => {
    useFleetStore.getState().setMode('replay');
    return () => useFleetStore.getState().setMode('live');
  }, []);

  const playback = usePlayback(span, span.to - START_BEFORE_END_MS);
  const { query, data, gaps } = useReplayHistory(satId, span);
  const markers = useAlertMarkers(span, satId);
  const exitReplay = () => navigate('/');

  useHotkeys('space', playback.toggle, { preventDefault: true });
  useHotkeys('left', () => playback.step(-MINUTE_MS), { preventDefault: true });
  useHotkeys('right', () => playback.step(MINUTE_MS), { preventDefault: true });
  useHotkeys('shift+left', () => playback.step(-10 * MINUTE_MS), { preventDefault: true });
  useHotkeys('shift+right', () => playback.step(10 * MINUTE_MS), { preventDefault: true });

  const satOptions = useMemo(
    () =>
      Object.values(catalog)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ value: String(s.satId), label: `${s.name} ${s.satId}` })),
    [catalog],
  );

  const offsetLabel = `T−${formatClock(span.to - playback.timeMs)}`;

  return (
    <div className="flex min-h-full flex-col gap-1">
      <Panel
        title="TIMELINE"
        subtitle={`LAST 6 H // ${new Date(span.from).toISOString().slice(11, 16)}Z – ${new Date(span.to).toISOString().slice(11, 16)}Z`}
        flush
        className="h-auto shrink-0"
      >
        <Timeline
          span={span}
          timeMs={playback.timeMs}
          onSeek={playback.seek}
          gaps={gaps}
          coverageKnown={data !== null}
          markers={markers}
        />
        <Transport playback={playback} offsetLabel={offsetLabel} onLive={exitReplay} />
      </Panel>

      <div className="grid min-h-[480px] flex-1 grid-cols-1 gap-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="GLOBE" subtitle="REPLAY // PROPAGATED FROM TLE" flush>
          <div className="relative h-full min-h-[320px]">
            <GlobeSlot
              mode="replay"
              timeMs={playback.timeMs}
              selectedSatId={satId}
              onSelectSat={selectSat}
              showGroundTracks
              showStations
              className="absolute inset-0"
            />
          </div>
        </Panel>

        <Panel
          title="TELEMETRY"
          subtitle={satName}
          flush
          bodyClassName="flex flex-col"
          controls={
            <>
              <SegmentedControl
                aria-label="Chart window"
                value={chartWindowMs}
                onValueChange={setChartWindowMs}
                options={CHART_WINDOWS}
              />
              <Select
                aria-label="Replay satellite"
                value={String(satId)}
                onValueChange={(id) => selectSat(Number(id))}
                options={satOptions}
                className="h-[22px] w-[176px]"
              />
            </>
          }
        >
          <ReplayReadouts data={data} timeMs={playback.timeMs} />
          {query.isPending ? (
            <LoadingState label="LOADING 6 H HISTORY" />
          ) : query.isError ? (
            <ErrorState
              title="HISTORY FAULT"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : data && data.tMs.length === 0 ? (
            <EmptyState
              title="NO TELEMETRY"
              detail="No data was recorded for this satellite in the last 6 hours."
            />
          ) : (
            data && (
              <ReplayCharts data={data} timeMs={playback.timeMs} windowMs={Number(chartWindowMs)} />
            )
          )}
        </Panel>
      </div>
    </div>
  );
}

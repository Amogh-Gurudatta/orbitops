// Next passes over ground stations (next 12 h) with live AOS / LOS countdowns. A pass in progress is
// drawn white (selection colour); the next one is highlighted; later passes are secondary text.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchStations, queryKeys } from '../../api/endpoints.ts';
import { cx } from '../../lib/cx.ts';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../ui/index.ts';
import { useNow } from './hooks.ts';
import {
  classifyPasses,
  formatDuration,
  formatUtcTime,
  passCountdown,
  type PassPhase,
} from './passes.ts';
import { fetchPasses, satelliteKeys } from './satelliteApi.ts';

const REFRESH_MS = 5 * 60_000;
const ROW_TONE: Record<PassPhase, string> = {
  active: 'text-select',
  next: 'text-text',
  upcoming: 'text-text-2',
  past: 'text-text-dim',
};

export function PassesPanel({ satId }: { satId: number }) {
  const passes = useQuery({
    queryKey: satelliteKeys.passes(satId),
    queryFn: () => fetchPasses(satId, 12),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS / 2,
  });
  const stations = useQuery({
    queryKey: queryKeys.stations,
    queryFn: fetchStations,
    staleTime: Infinity,
  });
  const names = useMemo(() => new Map(stations.data?.map((s) => [s.id, s.name])), [stations.data]);
  const now = useNow(1000);
  const list = useMemo(
    () => (passes.data ?? []).filter((p) => p.los > now - 1000),
    [passes.data, now],
  );
  const phases = classifyPasses(list, now);

  return (
    <Panel title="PASSES" subtitle="NEXT 12 H" flush>
      {passes.isPending ? (
        <LoadingState label="COMPUTING PASSES" />
      ) : passes.isError ? (
        <ErrorState
          title="PASS PREDICTION FAULT"
          error={passes.error}
          onRetry={() => void passes.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState title="NO PASSES" detail="No station contact predicted in the next 12 hours." />
      ) : (
        <div className="h-full overflow-auto">
          <Table>
            <THead>
              <tr>
                <TH>STATION</TH>
                <TH numeric>AOS</TH>
                <TH numeric>LOS</TH>
                <TH numeric>MAX EL</TH>
                <TH numeric>DUR</TH>
              </tr>
            </THead>
            <TBody>
              {list.slice(0, 20).map((pass, i) => {
                const phase = phases[i]!;
                return (
                  <TR
                    key={`${pass.stationId}-${pass.aos}`}
                    selected={phase === 'active'}
                    className={cx(ROW_TONE[phase])}
                  >
                    <TD className="max-w-[88px]">
                      {phase === 'next' && (
                        <span className="mnemonic mr-0.5 text-2xs text-select">NEXT</span>
                      )}
                      {names.get(pass.stationId) ?? pass.stationId}
                    </TD>
                    <TD numeric>{passCountdown(pass, now)}</TD>
                    <TD numeric>{formatUtcTime(pass.los).slice(0, 5)}Z</TD>
                    <TD numeric>{pass.maxElevDeg.toFixed(0)}°</TD>
                    <TD numeric>{formatDuration(pass)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

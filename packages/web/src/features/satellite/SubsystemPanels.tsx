// EPS / TCS / COMM / ADCS panels: fixed-position readouts on top, strip charts beneath. Readouts follow
// live frames at 5 Hz; charts pull from the store on the frame loop. Panel title colours with the
// worst active alert of that subsystem on this satellite.
import { useQuery } from '@tanstack/react-query';
import type { Subsystem } from '@orbitops/shared';
import { fetchStations, queryKeys } from '../../api/endpoints.ts';
import { useLatest } from '../../realtime/useRealtime.ts';
import { Panel, Readout, type ReadoutState } from '../../ui/index.ts';
import { cx } from '../../lib/cx.ts';
import { CHART_SPECS, limitState, type ChartKey, type ChartSpec } from './chartSpecs.ts';
import { SatChart } from './SatChart.tsx';
import { sourceLabel, type RangeConfig } from './ranges.ts';
import type { SatHistory } from './useSatHistory.ts';
import { useSubsystemState } from './useSubsystemState.ts';

interface PanelProps {
  satId: number;
  range: RangeConfig;
  history: SatHistory;
  /** No frames recently: readouts hatch. */
  stale: boolean;
}

const HZ = 5;

function useChartPanel(props: PanelProps, subsystem: Subsystem) {
  return {
    state: useSubsystemState(props.satId, subsystem),
    subtitle: historySubtitle(props),
  };
}

function historySubtitle({ range, history }: PanelProps): string {
  const base = sourceLabel(range);
  if (history.status === 'loading') return `${base} // LOADING`;
  if (history.status === 'error') return `${base} // HISTORY FAULT`;
  return base;
}

/** Readout for a charted metric: value in display units, limit state or STALE. */
function MetricReadout({
  chart,
  raw,
  stale,
  label,
}: {
  chart: ChartKey;
  raw: number | null | undefined;
  stale: boolean;
  label?: string;
}) {
  const spec: ChartSpec = CHART_SPECS[chart];
  const value = raw === null || raw === undefined ? null : raw * spec.factor;
  const state: ReadoutState = stale ? 'stale' : limitState(value, spec.limits);
  return (
    <Readout
      label={label ?? spec.label}
      value={value}
      unit={spec.unit}
      decimals={spec.decimals}
      state={state}
    />
  );
}

function Charts({ props, keys }: { props: PanelProps; keys: readonly ChartKey[] }) {
  return (
    <>
      {keys.map((key) => (
        <SatChart
          key={key}
          satId={props.satId}
          spec={CHART_SPECS[key]}
          range={props.range}
          bands={props.history.bands[key]}
        />
      ))}
    </>
  );
}

const BODY = 'flex flex-col';

export function EpsPanel(props: PanelProps) {
  const { state, subtitle } = useChartPanel(props, 'EPS');
  const v = useLatest(props.satId, ['batV', 'batSoc', 'solarW', 'busA', 'shadow'], HZ);
  const eclipsed = (v.shadow ?? 0) >= 0.5;
  return (
    <Panel title="EPS" subtitle={subtitle} state={state} flush bodyClassName={BODY}>
      <Readout
        label="BATT V"
        value={v.batV}
        unit="V"
        decimals={2}
        state={props.stale ? 'stale' : 'nominal'}
      />
      <MetricReadout chart="batSoc" raw={v.batSoc} stale={props.stale} label="SOC" />
      <MetricReadout chart="solarW" raw={v.solarW} stale={props.stale} label="SA PWR" />
      <MetricReadout chart="busA" raw={v.busA} stale={props.stale} label="BUS CUR" />
      <Readout
        label="ILLUM"
        value={
          v.shadow === undefined
            ? null
            : `${eclipsed ? 'ECL' : 'SUN'} ${Math.round(v.shadow * 100)}%`
        }
        state={props.stale ? 'stale' : 'nominal'}
      />
      <Charts props={props} keys={['batSoc', 'solarW', 'busA']} />
    </Panel>
  );
}

export function TcsPanel(props: PanelProps) {
  const { state, subtitle } = useChartPanel(props, 'TCS');
  const v = useLatest(props.satId, ['panelTempC', 'obcTempC'], HZ);
  return (
    <Panel title="TCS" subtitle={subtitle} state={state} flush bodyClassName={BODY}>
      <MetricReadout chart="panelTempC" raw={v.panelTempC} stale={props.stale} />
      <MetricReadout chart="obcTempC" raw={v.obcTempC} stale={props.stale} />
      <Charts props={props} keys={['panelTempC', 'obcTempC']} />
    </Panel>
  );
}

export function CommPanel(props: PanelProps) {
  const { state, subtitle } = useChartPanel(props, 'COMM');
  const v = useLatest(props.satId, ['rssiDbm', 'snrDb', 'stationId', 'elevDeg'], HZ);
  const stations = useQuery({
    queryKey: queryKeys.stations,
    queryFn: fetchStations,
    staleTime: Infinity,
  });
  const linked = v.stationId != null;
  const stationName = linked
    ? (stations.data?.find((s) => s.id === v.stationId)?.name ?? v.stationId)
    : null;
  const rowState: ReadoutState = props.stale ? 'stale' : 'nominal';
  return (
    <Panel title="COMM" subtitle={subtitle} state={state} flush bodyClassName={BODY}>
      <MetricReadout chart="rssiDbm" raw={v.rssiDbm} stale={props.stale} />
      <MetricReadout chart="snrDb" raw={v.snrDb} stale={props.stale} />
      <Readout
        label="STATION"
        value={stationName ?? 'NONE'}
        state={rowState}
        className="[&>span:nth-child(2)]:max-w-[16ch] [&>span:nth-child(2)]:truncate"
      />
      <Readout label="ELEV" value={v.elevDeg} unit="deg" decimals={1} state={rowState} />
      <div className="flex h-3 items-center justify-between border-b border-grid px-1">
        <span className="mnemonic text-xs text-text-2">LINK</span>
        <LinkLamp linked={linked && !props.stale} />
      </div>
      <Charts props={props} keys={['rssiDbm', 'snrDb']} />
    </Panel>
  );
}

/** White fill = link established; hatched = no link. Alarm colour is reserved for faults. */
function LinkLamp({ linked }: { linked: boolean }) {
  return (
    <span
      className={cx(
        'mnemonic inline-flex h-2 min-w-[56px] items-center justify-center border px-0.5 text-2xs',
        linked ? 'border-select bg-select text-bg' : 'hatch border-rule text-text-dim',
      )}
    >
      {linked ? 'LINK UP' : 'NO LINK'}
    </span>
  );
}

export function AdcsPanel(props: PanelProps) {
  const { state, subtitle } = useChartPanel(props, 'ADCS');
  const v = useLatest(props.satId, ['attRateDps', 'mode'], HZ);
  return (
    <Panel title="ADCS" subtitle={subtitle} state={state} flush bodyClassName={BODY}>
      <MetricReadout chart="attRateDps" raw={v.attRateDps} stale={props.stale} />
      <Readout label="MODE" value={v.mode ?? null} state={props.stale ? 'stale' : 'nominal'} />
      <Charts props={props} keys={['attRateDps']} />
    </Panel>
  );
}

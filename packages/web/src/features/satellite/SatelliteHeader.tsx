// Identity strip for the satellite page: name, NORAD, group, mode, status, data age, TLE epoch,
// satellite switcher and RANGE control, plus the history/live diagnostics line.
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { SpacecraftMode } from '@orbitops/shared';
import type { Satellite } from '../../api/types.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { useLatest } from '../../realtime/useRealtime.ts';
import { STALE_AFTER_MS } from '../../config.ts';
import { SegmentedControl, Select, StatusChip, Tag, type TagTone } from '../../ui/index.ts';
import { cx } from '../../lib/cx.ts';
import { useDataAgeS } from './hooks.ts';
import { RANGES, type RangeId } from './ranges.ts';
import type { SeamDiagnostics } from './useSeamDiagnostics.ts';
import type { SatHistory } from './useSatHistory.ts';

const MODE_TONE: Record<SpacecraftMode, TagTone> = {
  NOMINAL: 'neutral',
  ECLIPSE: 'neutral',
  SAFE: 'caution',
  DEGRADED: 'caution',
  LOS: 'stale',
};

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.id, label: r.label }));

export interface SatelliteHeaderProps {
  satellite: Satellite;
  rangeId: RangeId;
  onRangeChange(id: RangeId): void;
  history: SatHistory;
  diagnostics: SeamDiagnostics;
}

export function SatelliteHeader({
  satellite,
  rangeId,
  onRangeChange,
  history,
  diagnostics,
}: SatelliteHeaderProps) {
  const navigate = useNavigate();
  const catalog = useFleetStore((s) => s.catalog);
  const status = useFleetStore((s) => s.status[satellite.satId] ?? 'NOM');
  const { mode } = useLatest(satellite.satId, ['mode'], 2);
  const ageS = useDataAgeS(satellite.satId);

  const options = useMemo(
    () =>
      Object.values(catalog)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ value: String(s.satId), label: `${s.name} ${s.satId}` })),
    [catalog],
  );

  const ageStale = ageS !== null && ageS * 1000 > STALE_AFTER_MS;
  const fmt = new Intl.NumberFormat('en-US');

  return (
    <header className="flex shrink-0 flex-col border border-rule bg-panel" data-tour="sat-history">
      <div className="flex min-h-[40px] flex-wrap items-center gap-x-2 gap-y-0.5 px-1 py-0.5">
        <h1 className="mnemonic text-lg text-text">{satellite.name}</h1>
        <Field label="NORAD" value={String(satellite.satId)} />
        <Field label="GROUP" value={satellite.group.toUpperCase()} />
        {mode && (
          <span className="flex items-center gap-0.5">
            <span className="mnemonic text-xs text-text-dim">MODE</span>
            <Tag tone={MODE_TONE[mode]}>{mode}</Tag>
          </span>
        )}
        <StatusChip status={status} />
        <span className="flex items-center gap-0.5">
          <span className="mnemonic text-xs text-text-dim">DATA AGE</span>
          <span className={cx('num text-sm', ageStale ? 'text-caution' : 'text-text')}>
            {ageS === null ? '—' : `${ageS.toFixed(1)} s`}
          </span>
        </span>
        <Field label="TLE EPOCH" value={formatEpoch(satellite.epoch)} />
        <span className="flex-1" />
        <Select
          aria-label="Switch satellite"
          value={String(satellite.satId)}
          onValueChange={(id) => navigate(`/sat/${id}`)}
          options={options}
          className="w-[200px]"
        />
        <div className="flex items-center gap-1">
          <span className="mnemonic text-xs text-text-dim">RANGE</span>
          <SegmentedControl
            aria-label="History range"
            value={rangeId}
            onValueChange={onRangeChange}
            options={RANGE_OPTIONS}
          />
        </div>
      </div>
      <div className="num flex h-3 items-center gap-1 border-t border-rule px-1 text-2xs text-text-2">
        <span>HIST {history.status === 'loading' ? '…' : fmt.format(history.points)} PTS</span>
        <span className="text-text-dim">·</span>
        <span>LIVE {fmt.format(diagnostics.livePoints)} PTS</span>
        <span className="text-text-dim">·</span>
        <span>DUP DROPPED {fmt.format(diagnostics.dropped)}</span>
        <span className="text-text-dim">·</span>
        <span className={diagnostics.renderedFaults > 0 ? 'text-warning' : undefined}>
          RENDERED DUP {diagnostics.renderedFaults}
        </span>
      </div>
    </header>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-0.5">
      <span className="mnemonic text-xs text-text-dim">{label}</span>
      <span className="num text-sm text-text-2">{value}</span>
    </span>
  );
}

/** The catalogue serves the TLE epoch as epoch ms (typed string in api/types); accept either. */
function formatEpoch(epoch: number | string): string {
  const date = new Date(epoch);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toISOString().slice(0, 19).replace('T', ' ') + 'Z';
}

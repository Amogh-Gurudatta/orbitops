// Ground station list: identity, location, minimum elevation, satellites in view now and the next AOS at the
// station. Arrow keys move the selection.
import { memo, type KeyboardEvent } from 'react';
import type { GroundStation, Pass } from '../../api/types.ts';
import { Tag, TBody, TD, TH, THead, TR } from '../../ui/index.ts';
import { formatCountdown } from '../fleet/SelectedPanel.tsx';

/** Earliest AOS in the future per station. */
export function nextAosByStation(passes: readonly Pass[], now: number): Map<string, number> {
  const next = new Map<string, number>();
  for (const p of passes) {
    if (p.aos <= now) continue;
    const current = next.get(p.stationId);
    if (current === undefined || p.aos < current) next.set(p.stationId, p.aos);
  }
  return next;
}

const Row = memo(function Row({
  station,
  selected,
  inView,
  nextAos,
  now,
  onSelect,
}: {
  station: GroundStation;
  selected: boolean;
  inView: number | undefined;
  nextAos: number | undefined;
  now: number;
  onSelect(id: string): void;
}) {
  return (
    <TR selected={selected} data-station-id={station.id} onClick={() => onSelect(station.id)}>
      <TD className="mnemonic text-xs text-text">{station.id}</TD>
      <TD className="truncate">{station.name}</TD>
      <TD className="mnemonic text-xs text-text-2">{station.network}</TD>
      <TD numeric>{station.lat.toFixed(2)}</TD>
      <TD numeric>{station.lon.toFixed(2)}</TD>
      <TD numeric>{station.minElevDeg}°</TD>
      <TD numeric>
        {inView === undefined ? (
          '—'
        ) : inView > 0 ? (
          <Tag tone="neutral" className="text-text">
            {inView}
          </Tag>
        ) : (
          0
        )}
      </TD>
      <TD numeric>{nextAos === undefined ? '—' : `T-${formatCountdown(nextAos - now)}`}</TD>
    </TR>
  );
});

export function StationTable({
  stations,
  selectedId,
  inView,
  nextAos,
  now,
  onSelect,
}: {
  stations: readonly GroundStation[];
  selectedId: string | null;
  inView: ReadonlyMap<string, number>;
  nextAos: ReadonlyMap<string, number>;
  now: number;
  onSelect(id: string): void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = stations.findIndex((s) => s.id === selectedId);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      stations[Math.min(stations.length - 1, Math.max(0, (index < 0 ? 0 : index) + step))];
    if (next) onSelect(next.id);
  };

  return (
    <div
      tabIndex={0}
      aria-label="Ground stations"
      onKeyDown={onKeyDown}
      className="h-full overflow-auto outline-offset-[-1px]"
    >
      <table className="w-full min-w-[620px] table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col style={{ width: 56 }} />
          <col />
          <col style={{ width: 80 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 80 }} />
        </colgroup>
        <THead>
          <tr>
            <TH>CODE</TH>
            <TH>NAME</TH>
            <TH>NETWORK</TH>
            <TH numeric>LAT</TH>
            <TH numeric>LON</TH>
            <TH numeric>MIN EL</TH>
            <TH numeric>IN VIEW</TH>
            <TH numeric>NEXT AOS</TH>
          </tr>
        </THead>
        <TBody>
          {stations.map((station) => (
            <Row
              key={station.id}
              station={station}
              selected={station.id === selectedId}
              inView={inView.get(station.id)}
              nextAos={nextAos.get(station.id)}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </TBody>
      </table>
    </div>
  );
}

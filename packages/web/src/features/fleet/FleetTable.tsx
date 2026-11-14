// Dense fleet table: one row per satellite, sortable columns, group/status/text filters, keyboard navigation
// (arrows move the selection, Enter opens). Rows are memoised; the 2 Hz row model keeps unchanged rows identical.
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SAT_GROUPS } from '@orbitops/shared';
import { cx } from '../../lib/cx.ts';
import {
  Icon,
  Input,
  Select,
  SegmentedControl,
  StatusChip,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../ui/index.ts';
import { limitState } from './limits.ts';
import type { FleetRowData } from './useFleetRows.ts';

type SortKey =
  | 'satId'
  | 'name'
  | 'group'
  | 'mode'
  | 'batSoc'
  | 'solarW'
  | 'panelTempC'
  | 'stationId'
  | 'altKm'
  | 'ageS'
  | 'status';
type StatusFilter = 'all' | 'abnormal';

const GROUP_CODE: Record<string, string> = {
  stations: 'STN',
  weather: 'WX',
  comms: 'COM',
  'earth-obs': 'EO',
  navigation: 'NAV',
  science: 'SCI',
  amateur: 'AMA',
};

const MODE_CODE: Record<string, string> = {
  NOMINAL: 'NOM',
  ECLIPSE: 'ECL',
  DEGRADED: 'DEG',
  SAFE: 'SAFE',
  LOS: 'LOS',
};

const STATUS_RANK = { WARN: 0, CAUT: 1, STALE: 2, NOM: 3 } as const;

interface Column {
  key: SortKey;
  label: string;
  width: number;
  numeric?: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: 'satId', label: 'NORAD', width: 56, numeric: true },
  { key: 'name', label: 'NAME', width: 136 },
  { key: 'group', label: 'GRP', width: 40 },
  { key: 'mode', label: 'MODE', width: 48 },
  { key: 'batSoc', label: 'BATT %', width: 96, numeric: true },
  { key: 'solarW', label: 'SA W', width: 48, numeric: true },
  { key: 'panelTempC', label: 'PNL °C', width: 56, numeric: true },
  { key: 'stationId', label: 'LINK', width: 48 },
  { key: 'altKm', label: 'ALT km', width: 56, numeric: true },
  { key: 'ageS', label: 'AGE s', width: 40, numeric: true },
  { key: 'status', label: 'STATUS', width: 56 },
];

function compare(a: FleetRowData, b: FleetRowData, key: SortKey): number {
  if (key === 'status') return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  const x = a[key];
  const y = b[key];
  // Missing values always sort last, whatever the direction.
  if (x === null) return y === null ? 0 : 1;
  if (y === null) return -1;
  return typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
}

const fixed = (v: number | null, digits: number) => (v === null ? '—' : v.toFixed(digits));

function BatteryCell({ soc }: { soc: number | null }) {
  const state = limitState('batSoc', soc);
  const pct = soc === null ? 0 : Math.max(0, Math.min(1, soc)) * 100;
  const tone =
    state === 'warning' ? 'bg-warning' : state === 'caution' ? 'bg-caution' : 'bg-text-2';
  return (
    <div className="flex items-center justify-end gap-1">
      <span aria-hidden="true" className="relative h-[6px] w-[24px] shrink-0 border border-rule">
        <span className={cx('absolute inset-y-0 left-0', tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="num w-[40px] text-right">{soc === null ? '—' : (soc * 100).toFixed(1)}</span>
    </div>
  );
}

interface RowProps {
  row: FleetRowData;
  selected: boolean;
  onSelect(satId: number): void;
  onOpen(satId: number): void;
}

const FleetRow = memo(function FleetRow({ row, selected, onSelect, onOpen }: RowProps) {
  const stale = row.status === 'STALE';
  const tone = row.status === 'WARN' ? 'warning' : row.status === 'CAUT' ? 'caution' : undefined;
  const cell = (metric: 'panelTempC') => {
    const state = stale ? 'nominal' : limitState(metric, row[metric]);
    return state === 'warning' ? 'text-warning' : state === 'caution' ? 'text-caution' : '';
  };
  return (
    <TR
      state={stale ? 'stale' : undefined}
      selected={selected}
      data-sat-id={row.satId}
      onClick={() => onSelect(row.satId)}
      onDoubleClick={() => onOpen(row.satId)}
    >
      <TD numeric className="text-text-2">
        {row.satId}
      </TD>
      <TD
        className={cx(tone === 'warning' && 'text-warning', tone === 'caution' && 'text-caution')}
      >
        {row.name}
      </TD>
      <TD className="mnemonic text-xs text-text-2">{GROUP_CODE[row.group] ?? row.group}</TD>
      <TD className="mnemonic text-xs">{row.mode ? (MODE_CODE[row.mode] ?? row.mode) : '—'}</TD>
      <TD className="p-0 pr-1">
        <BatteryCell soc={row.batSoc} />
      </TD>
      <TD numeric>{fixed(row.solarW, 0)}</TD>
      <TD numeric className={cell('panelTempC')}>
        {fixed(row.panelTempC, 1)}
      </TD>
      <TD className="mnemonic text-xs">{row.stationId ?? '—'}</TD>
      <TD numeric>{fixed(row.altKm, 0)}</TD>
      <TD numeric className={stale ? 'text-text-dim' : undefined}>
        {row.ageS ?? '—'}
      </TD>
      <TD>
        <StatusChip status={row.status} />
      </TD>
    </TR>
  );
});

export function FleetTable({
  rows,
  selectedSatId,
  onSelect,
  onOpen,
}: {
  rows: readonly FleetRowData[];
  selectedSatId: number | null;
  onSelect(satId: number): void;
  onOpen(satId: number): void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'satId', dir: 1 });
  const [group, setGroup] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (group !== 'all' && r.group !== group) return false;
      if (status === 'abnormal' && r.status === 'NOM') return false;
      return !needle || r.name.toLowerCase().includes(needle) || String(r.satId).includes(needle);
    });
    return filtered.sort((a, b) => compare(a, b, sort.key) * sort.dir || a.satId - b.satId);
  }, [rows, group, status, text, sort]);

  // Keep the selected row in view when selection comes from the globe or the keyboard.
  useEffect(() => {
    if (selectedSatId === null) return;
    scrollRef.current
      ?.querySelector(`[data-sat-id="${selectedSatId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedSatId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement)
      return;
    const index = visible.findIndex((r) => r.satId === selectedSatId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = visible[index < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, index + step))];
      if (next) onSelect(next.satId);
    } else if (event.key === 'Enter' && selectedSatId !== null) {
      onOpen(selectedSatId);
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const groupOptions = [
    { value: 'all', label: 'ALL GROUPS' },
    ...SAT_GROUPS.map((g) => ({ value: g, label: g.toUpperCase() })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-rule p-1">
        <div className="w-[176px]">
          <Input
            aria-label="Filter satellites by name or NORAD id"
            placeholder="FILTER NAME / NORAD"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by group"
          value={group}
          onValueChange={setGroup}
          options={groupOptions}
          className="w-[136px]"
        />
        <SegmentedControl<StatusFilter>
          aria-label="Filter by status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: 'all', label: 'ALL' },
            { value: 'abnormal', label: 'ABNORMAL' },
          ]}
        />
        <span className="num ml-auto text-xs text-text-dim">
          {visible.length}/{rows.length}
        </span>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label="Fleet table"
        className="min-h-0 flex-1 overflow-auto outline-offset-[-1px]"
      >
        <table className="w-full min-w-[680px] table-fixed border-collapse text-left text-sm">
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <THead>
            <tr>
              {COLUMNS.map((c) => (
                <TH
                  key={c.key}
                  numeric={c.numeric}
                  aria-sort={
                    sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={cx(
                      'mnemonic inline-flex items-center gap-0.5 hover:text-text',
                      sort.key === c.key && 'text-text',
                    )}
                  >
                    {c.label}
                    {sort.key === c.key && (
                      <Icon
                        name="chevron"
                        size={10}
                        className={sort.dir === 1 ? 'rotate-180' : undefined}
                      />
                    )}
                  </button>
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {visible.map((row) => (
              <FleetRow
                key={row.satId}
                row={row}
                selected={row.satId === selectedSatId}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            ))}
          </TBody>
        </table>
        {rows.length === 0 && <p className="mnemonic p-1 text-xs text-text-2">ACQUIRING FLEET…</p>}
        {rows.length > 0 && visible.length === 0 && (
          <p className="mnemonic p-1 text-xs text-text-dim">NO SATELLITES MATCH THE FILTER</p>
        )}
      </div>
    </div>
  );
}

// /sat without an id: searchable list of the fleet to pick a satellite from.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import {
  EmptyState,
  Input,
  LoadingState,
  Panel,
  StatusChip,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../ui/index.ts';

export function SatellitePicker() {
  const navigate = useNavigate();
  const catalog = useFleetStore((s) => s.catalog);
  const status = useFleetStore((s) => s.status);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return Object.values(catalog)
      .filter(
        (s) => !needle || s.name.toLowerCase().includes(needle) || String(s.satId).includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, filter]);

  return (
    <Panel
      title="SAT"
      subtitle="SELECT SATELLITE"
      flush
      bodyClassName="flex flex-col"
      controls={
        <Input
          aria-label="Filter satellites"
          placeholder="NAME / NORAD"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-2 w-[160px] text-xs"
        />
      }
    >
      {Object.keys(catalog).length === 0 ? (
        <LoadingState label="LOADING CATALOGUE" />
      ) : rows.length === 0 ? (
        <EmptyState title="NO MATCH" detail="No satellite matches the filter." />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <THead>
              <tr>
                <TH>NAME</TH>
                <TH numeric>NORAD</TH>
                <TH>GROUP</TH>
                <TH>STATUS</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.satId} onClick={() => navigate(`/sat/${s.satId}`)}>
                  <TD>{s.name}</TD>
                  <TD numeric>{s.satId}</TD>
                  <TD className="text-text-2">{s.group.toUpperCase()}</TD>
                  <TD>
                    <StatusChip status={status[s.satId] ?? 'NOM'} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

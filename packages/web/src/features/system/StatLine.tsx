// One dense label ...... value unit row, as in the Readout kit component but with room for longer units.
import type { ReactNode } from 'react';

export function StatLine({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="grid h-3 grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-1 border-b border-grid px-1">
      <span className="mnemonic truncate text-xs text-text-2" title={note}>
        {label}
      </span>
      <span className="num text-right text-sm font-bold text-text">{value}</span>
      <span className="truncate text-2xs text-text-dim">{unit}</span>
    </div>
  );
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmt1 = (n: number) => n.toFixed(1);

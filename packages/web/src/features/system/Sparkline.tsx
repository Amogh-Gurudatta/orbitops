// Inline SVG sparkline for table cells: a grey polyline scaled to the series' own min / max.
const W = 64;
const H = 16;

export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  if (values.length < 2) return <span className="text-text-dim">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg width={W} height={H} role="img" aria-label={label} className="block">
      <polyline
        points={points}
        fill="none"
        stroke="#BEBCB4"
        strokeWidth="1"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

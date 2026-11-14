// Fleet page grid layout: defaults, the narrow single-column variant and localStorage persistence. Pure helpers
// so the stored value is validated before it can break the page.
export type PanelId = 'pipeline' | 'globe' | 'fleet' | 'alarms' | 'selected';

export interface PanelLayout {
  i: PanelId;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export const GRID_COLS = 12;
export const GRID_ROWS = 24;
export const STORAGE_KEY = 'orbitops.fleet.layout.v1';

export const DEFAULT_LAYOUT: readonly PanelLayout[] = [
  { i: 'pipeline', x: 0, y: 0, w: 12, h: 2, minW: 6, minH: 2 },
  { i: 'globe', x: 0, y: 2, w: 6, h: 14, minW: 3, minH: 6 },
  { i: 'fleet', x: 6, y: 2, w: 6, h: 16, minW: 3, minH: 6 },
  { i: 'alarms', x: 0, y: 16, w: 6, h: 8, minW: 3, minH: 4 },
  { i: 'selected', x: 6, y: 18, w: 6, h: 6, minW: 3, minH: 5 },
];

/** One column, stacked in reading order, for narrow windows (no drag/resize there). */
export const NARROW_LAYOUT: readonly PanelLayout[] = (() => {
  const heights: Record<PanelId, number> = {
    pipeline: 3,
    globe: 14,
    fleet: 14,
    alarms: 10,
    selected: 10,
  };
  const order: PanelId[] = ['pipeline', 'globe', 'fleet', 'selected', 'alarms'];
  let y = 0;
  return order.map((i) => {
    const item: PanelLayout = { i, x: 0, y, w: 1, h: heights[i], minW: 1, minH: 2 };
    y += heights[i];
    return item;
  });
})();

const IDS = new Set<string>(DEFAULT_LAYOUT.map((p) => p.i));

const isCell = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Parses a stored layout; anything malformed, partial or out of the grid yields null (use the default). */
export function parseLayout(raw: string | null): PanelLayout[] | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length !== DEFAULT_LAYOUT.length) return null;
  const seen = new Set<string>();
  const result: PanelLayout[] = [];
  for (const entry of data as Record<string, unknown>[]) {
    const { i, x, y, w, h } = entry;
    if (typeof i !== 'string' || !IDS.has(i) || seen.has(i)) return null;
    if (!isCell(x) || !isCell(y) || !isCell(w) || !isCell(h) || w < 1 || h < 1) return null;
    if (x + w > GRID_COLS) return null;
    seen.add(i);
    const base = DEFAULT_LAYOUT.find((p) => p.i === i)!;
    result.push({ ...base, x, y, w, h });
  }
  return result;
}

export function loadLayout(): PanelLayout[] {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY)) ?? [...DEFAULT_LAYOUT];
  } catch {
    return [...DEFAULT_LAYOUT];
  }
}

export function saveLayout(
  layout: readonly { i: string; x: number; y: number; w: number; h: number }[],
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))),
    );
  } catch {
    // Storage may be blocked (private window); the layout simply will not persist.
  }
}

export function clearLayout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

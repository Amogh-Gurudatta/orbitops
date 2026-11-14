// Grey Room colours as deck.gl RGBA tuples, mirroring the tokens in styles/theme.css. Colour is reserved for
// state: status, selection and predicted tracks; geography stays in greys.
import type { SatStatus } from '../../realtime/status.ts';

export type Rgba = [number, number, number, number];

export const OCEAN_HEX = '#151614';

export const LAND: Rgba = [58, 59, 55, 255];
export const GRATICULE: Rgba = [46, 47, 44, 255];
export const NIGHT: Rgba = [8, 8, 7, 112];
export const PAST_TRACK: Rgba = [154, 152, 143, 150];
export const PREDICTED_TRACK: Rgba = [208, 79, 208, 255];
export const STATION: Rgba = [154, 152, 143, 255];
export const STATION_LABEL: Rgba = [154, 152, 143, 255];
export const SELECT: Rgba = [255, 255, 255, 255];
export const LABEL_BG: Rgba = [28, 29, 27, 230];
export const LABEL_BORDER: Rgba = [58, 59, 55, 255];
export const COVERAGE_RAMP: readonly Rgba[] = [
  [190, 188, 180, 34],
  [190, 188, 180, 56],
  [190, 188, 180, 78],
];

export const STATUS_COLOR: Record<SatStatus, Rgba> = {
  NOM: [216, 214, 206, 255],
  CAUT: [242, 169, 0, 255],
  WARN: [232, 55, 44, 255],
  STALE: [98, 97, 91, 255],
};

/** CSS hex for the legend swatches (same values as above). */
export const STATUS_CSS: Record<SatStatus, string> = {
  NOM: '#d8d6ce',
  CAUT: '#f2a900',
  WARN: '#e8372c',
  STALE: '#62615b',
};

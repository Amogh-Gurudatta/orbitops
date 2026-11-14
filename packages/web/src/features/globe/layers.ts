// deck.gl layer builders for the globe. Static layers (ocean, land, graticule) are created once; the rest are
// rebuilt by the render loop from plain data. Everything is Grey Room styled: land and sea in greys, colour only
// for satellite state, selection and predicted tracks.
import { BitmapLayer, IconLayer, PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import type { Layer } from '@deck.gl/core';
import type { GroundStation } from '../../api/types.ts';
import { dashPath, splitAtAntimeridian, type LonLat } from './antimeridian.ts';
import type { CoverageCell } from './footprint.ts';
import { ICON_MAPPING, iconAtlasUrl, oceanImageUrl } from './icons.ts';
import landData from './data/land110m.json';
import {
  COVERAGE_RAMP,
  GRATICULE,
  LABEL_BG,
  LABEL_BORDER,
  LAND,
  NIGHT,
  PAST_TRACK,
  PREDICTED_TRACK,
  SELECT,
  STATION,
  STATION_LABEL,
  type Rgba,
} from './palette.ts';

/** Natural Earth 110m land (public domain): an array of polygons, each an array of lon/lat rings. */
const LAND_POLYGONS = landData as unknown as [number, number][][][];

/**
 * Flat geography is drawn in layer order without depth testing: the ocean/land/night meshes are tessellated at
 * different resolutions, so their depths disagree by kilometres and would z-fight. The ocean (depth-writing)
 * still occludes satellites behind the globe, and the view's back-face culling keeps the far side from drawing.
 */
const FLAT: { depthCompare: 'always'; depthWriteEnabled: false } = {
  depthCompare: 'always',
  depthWriteEnabled: false,
};

/** Screen-facing sprites have no consistent winding on the sphere, so the globe view's back-face culling must be off. */
const SPRITE: { cullMode: 'none' } = { cullMode: 'none' };

/** Lines and markers float this high (metres) so they clear the faceted ocean mesh (up to ~4 km of sag). */
const SURFACE_LIFT_M = 12_000;

const LABEL_FONT = '"B612 Mono", ui-monospace, monospace';

export interface SatPoint {
  satId: number;
  name: string;
  position: [lon: number, lat: number, altM: number];
  altKm: number;
  icon: 'sat' | 'satHollow';
  color: Rgba;
}

type Lifted = [number, number, number];
const lift = (path: readonly LonLat[]): Lifted[] =>
  path.map(([lon, lat]) => [lon, lat, SURFACE_LIFT_M]);

function buildGraticule(): LonLat[][] {
  const lines: LonLat[][] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const line: LonLat[] = [];
    for (let lat = -90; lat <= 90; lat += 5) line.push([lon, lat]);
    lines.push(line);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const line: LonLat[] = [];
    for (let lon = -180; lon <= 180; lon += 5) line.push([lon, lat]);
    lines.push(line);
  }
  return lines;
}

const GRATICULE_LINES = buildGraticule();

/**
 * Ocean disc, land and graticule. Layer instances are cheap and must not outlive their Deck, so they are built
 * fresh each frame; the data arrays are module constants, which lets deck.gl's diff skip re-uploading them.
 */
export function baseLayers(): Layer[] {
  return [
    new BitmapLayer({
      id: 'ocean',
      image: oceanImageUrl(),
      bounds: [-180, -90, 180, 90],
    }),
    new SolidPolygonLayer<[number, number][][]>({
      id: 'land',
      data: LAND_POLYGONS,
      getPolygon: (d) => d as unknown as [number, number][],
      getFillColor: LAND,
      parameters: FLAT,
    }),
    new PathLayer<LonLat[]>({
      id: 'graticule',
      data: GRATICULE_LINES,
      getPath: (d) => lift(d),
      getColor: GRATICULE,
      widthUnits: 'pixels',
      getWidth: 1,
    }),
  ];
}

/** Night hemisphere shade; `minuteKey` re-triggers the geometry when the terminator moves. */
export function nightLayer(ring: LonLat[], minuteKey: number): Layer {
  return new SolidPolygonLayer<LonLat[]>({
    id: 'night',
    data: [ring],
    getPolygon: (d) => d as unknown as [number, number][],
    getFillColor: NIGHT,
    parameters: FLAT,
    updateTriggers: { getPolygon: minuteKey },
  });
}

export function coverageLayer(cells: readonly CoverageCell[]): Layer {
  return new H3HexagonLayer<CoverageCell>({
    id: 'coverage',
    data: cells as CoverageCell[],
    getHexagon: (d) => d.cell,
    getFillColor: (d) =>
      COVERAGE_RAMP[Math.min(d.count, COVERAGE_RAMP.length) - 1] ?? COVERAGE_RAMP[0]!,
    extruded: false,
    stroked: false,
    highPrecision: true,
    parameters: FLAT,
  });
}

export function stationLayers(
  stations: readonly GroundStation[],
  highlightId: string | undefined,
  fontKey: number,
): Layer[] {
  return [
    new IconLayer<GroundStation>({
      id: 'stations',
      data: stations as GroundStation[],
      iconAtlas: iconAtlasUrl(),
      iconMapping: ICON_MAPPING,
      getIcon: (d) => (d.id === highlightId ? 'stationSolid' : 'station'),
      getPosition: (d) => [d.lon, d.lat, SURFACE_LIFT_M],
      getSize: (d) => (d.id === highlightId ? 18 : 14),
      getColor: (d) => (d.id === highlightId ? SELECT : STATION),
      sizeUnits: 'pixels',
      parameters: SPRITE,
      updateTriggers: { getIcon: highlightId, getSize: highlightId, getColor: highlightId },
    }),
    new TextLayer<GroundStation>({
      id: `station-labels-${fontKey}`,
      data: stations as GroundStation[],
      getPosition: (d) => [d.lon, d.lat, SURFACE_LIFT_M],
      getText: (d) => d.id,
      getSize: 10,
      getColor: (d) => (d.id === highlightId ? SELECT : STATION_LABEL),
      getPixelOffset: [10, 0],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      fontFamily: LABEL_FONT,
      characterSet: 'auto',
      sizeUnits: 'pixels',
      parameters: SPRITE,
      updateTriggers: { getColor: highlightId },
    }),
  ];
}

export interface TrackSet {
  past: LonLat[];
  future: LonLat[];
}

/** Grey past track and dashed magenta predicted track, antimeridian-safe. */
export function trackLayers(track: TrackSet): Layer[] {
  const past = splitAtAntimeridian(track.past);
  const future = splitAtAntimeridian(track.future).flatMap((segment) => dashPath(segment, 2, 1));
  return [
    new PathLayer<LonLat[]>({
      id: 'track-past',
      data: past,
      getPath: (d) => lift(d),
      getColor: PAST_TRACK,
      widthUnits: 'pixels',
      getWidth: 1,
    }),
    new PathLayer<LonLat[]>({
      id: 'track-future',
      data: future,
      getPath: (d) => lift(d),
      getColor: PREDICTED_TRACK,
      widthUnits: 'pixels',
      getWidth: 1.5,
    }),
  ];
}

export interface SatLayerInput {
  points: readonly SatPoint[];
  selected: SatPoint | undefined;
  fontKey: number;
  /** Bumped whenever positions/colours were recomputed, so deck.gl re-reads the accessors. */
  tick: number;
}

export function satelliteLayers({ points, selected, fontKey, tick }: SatLayerInput): Layer[] {
  const layers: Layer[] = [
    new IconLayer<SatPoint>({
      id: 'satellites',
      data: points as SatPoint[],
      iconAtlas: iconAtlasUrl(),
      iconMapping: ICON_MAPPING,
      getIcon: (d) => d.icon,
      getPosition: (d) => d.position,
      getSize: 11,
      getColor: (d) => d.color,
      sizeUnits: 'pixels',
      parameters: SPRITE,
      pickable: true,
      autoHighlight: false,
      updateTriggers: { getIcon: tick, getPosition: tick, getColor: tick },
    }),
  ];
  if (selected) {
    layers.push(
      new IconLayer<SatPoint>({
        id: 'selection-ring',
        data: [selected],
        iconAtlas: iconAtlasUrl(),
        iconMapping: ICON_MAPPING,
        getIcon: () => 'ring',
        getPosition: (d) => d.position,
        getSize: 24,
        getColor: SELECT,
        sizeUnits: 'pixels',
        parameters: SPRITE,
        updateTriggers: { getPosition: tick },
      }),
      new TextLayer<SatPoint>({
        id: `selection-label-${fontKey}`,
        data: [selected],
        getPosition: (d) => d.position,
        getText: (d) => `${d.name}  ${d.satId}`,
        getSize: 11,
        getColor: SELECT,
        getPixelOffset: [18, -2],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        characterSet: 'auto',
        sizeUnits: 'pixels',
        parameters: SPRITE,
        background: true,
        backgroundPadding: [4, 2],
        getBackgroundColor: LABEL_BG,
        getBorderColor: LABEL_BORDER,
        getBorderWidth: 1,
        updateTriggers: { getPosition: tick, getText: tick },
      }),
    );
  }
  return layers;
}

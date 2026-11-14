// Marker glyphs for the globe, drawn once into a small canvas atlas and used as masks (deck.gl tints them per
// object). Squares/diamonds for satellites, a hollow triangle for ground stations, a ring for selection.
import { OCEAN_HEX } from './palette.ts';

const CELL = 48;

export type GlyphName = 'sat' | 'satHollow' | 'station' | 'stationSolid' | 'ring';
const ORDER: readonly GlyphName[] = ['sat', 'satHollow', 'station', 'stationSolid', 'ring'];

export const ICON_MAPPING = Object.fromEntries(
  ORDER.map((name, i) => [name, { x: i * CELL, y: 0, width: CELL, height: CELL, mask: true }]),
);

function trace(ctx: CanvasRenderingContext2D, name: GlyphName, cx: number): void {
  const mid = CELL / 2;
  ctx.beginPath();
  switch (name) {
    case 'sat':
    case 'satHollow':
      ctx.moveTo(cx + mid, 6);
      ctx.lineTo(cx + CELL - 6, mid);
      ctx.lineTo(cx + mid, CELL - 6);
      ctx.lineTo(cx + 6, mid);
      ctx.closePath();
      break;
    case 'station':
    case 'stationSolid':
      ctx.moveTo(cx + mid, 6);
      ctx.lineTo(cx + CELL - 6, CELL - 8);
      ctx.lineTo(cx + 6, CELL - 8);
      ctx.closePath();
      break;
    case 'ring':
      ctx.arc(cx + mid, mid, mid - 5, 0, Math.PI * 2);
      break;
  }
}

let atlasUrl: string | null = null;

/** PNG data URL of the glyph atlas (white on transparent). Built lazily in the browser. */
export function iconAtlasUrl(): string {
  if (atlasUrl) return atlasUrl;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * ORDER.length;
  canvas.height = CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'miter';
  ORDER.forEach((name, i) => {
    trace(ctx, name, i * CELL);
    if (name === 'sat' || name === 'stationSolid') ctx.fill();
    else {
      ctx.lineWidth = name === 'ring' ? 4 : 5;
      ctx.stroke();
    }
  });
  atlasUrl = canvas.toDataURL('image/png');
  return atlasUrl;
}

let oceanUrl: string | null = null;

/** 2x2 solid-colour PNG used as the ocean texture (deck.gl has no flat sphere layer). */
export function oceanImageUrl(): string {
  if (oceanUrl) return oceanUrl;
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = OCEAN_HEX;
    ctx.fillRect(0, 0, 2, 2);
  }
  oceanUrl = canvas.toDataURL('image/png');
  return oceanUrl;
}

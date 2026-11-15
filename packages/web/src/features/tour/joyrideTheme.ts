// Maps the Grey Room tokens onto react-joyride's options. The overlay is the console background at 70%,
// the spotlight a 1px white outline with square corners, and everything joyride animates or shadows by
// default (beacon, loader, floater fade and drop shadow, arrow) is switched off.
import type { Options, Props, Styles } from 'react-joyride';

/** Above the console bar, panels and dialogs (z-50); below toasts. */
export const TOUR_Z_INDEX = 60;

const OVERLAY_ALPHA = 'b3'; // 70% as the last byte of an 8-digit hex colour
const SCROLL_MS = 80;

/** Reads a theme token from :root; falls back to the shipped value if the stylesheet is not applied. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function joyrideOptions(reducedMotion: boolean): Partial<Options> {
  return {
    skipBeacon: true,
    zIndex: TOUR_Z_INDEX,
    spotlightPadding: 4,
    spotlightRadius: 0,
    offset: 8,
    scrollOffset: 24,
    // Plain scroll under prefers-reduced-motion, otherwise a single 80 ms linear step.
    scrollDuration: reducedMotion ? 0 : SCROLL_MS,
    blockTargetInteraction: true,
    overlayClickAction: false,
    dismissKeyAction: 'close',
    buttons: ['back', 'primary', 'skip'],
  };
}

export function joyrideStyles(): Partial<Styles> {
  const bg = token('--color-bg', '#1c1d1b');
  const select = token('--color-select', '#ffffff');
  return {
    overlay: { backgroundColor: `${bg}${OVERLAY_ALPHA}` },
    spotlight: { stroke: select, strokeWidth: 1, fill: 'none', shapeRendering: 'crispEdges' },
    floater: { filter: 'none', transition: 'none' },
  };
}

export const joyrideFloating: NonNullable<Props['floatingOptions']> = { hideArrow: true };

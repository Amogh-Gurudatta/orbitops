// Custom glyph set: 16x16 grid, 1.5px stroke, square caps, mitred joins (engineering-drawing feel).
// Glyphs are defined once as <symbol>s in an inline sprite mounted at the app root; <Icon> references them.
import type { SVGProps } from 'react';

const GLYPHS = {
  satellite: 'M6 6h4v4H6z M1 6.5h4v3H1z M11 6.5h4v3h-4z M5 8h1 M10 8h1 M8 6V3 M6.5 2.5h3',
  station: 'M3 4.5a6 6 0 0 0 6.5 6.5 M3 4.5L9.5 11 M9.5 11L12.5 4 M8 11.5V14 M5 14h6',
  alarm: 'M8 2L14.5 13.5H1.5Z M8 6.5v3.5 M8 11.8v.7',
  globe:
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M8 1.5c-2.8 2.2-2.8 10.8 0 13 M8 1.5c2.8 2.2 2.8 10.8 0 13 M1.5 8h13',
  chart: 'M2 2v12h12 M4.5 10.5L7 7l2.2 2.2L13 4',
  list: 'M5.5 4h9 M5.5 8h9 M5.5 12h9 M1.5 4h1.5 M1.5 8h1.5 M1.5 12h1.5',
  gear: 'M6.6 1.5h2.8l.4 1.9 1.1.5 1.7-1 2 2-1 1.7.5 1.1 1.9.4v2.8l-1.9.4-.5 1.1 1 1.7-2 2-1.7-1-1.1.5-.4 1.9H6.6l-.4-1.9-1.1-.5-1.7 1-2-2 1-1.7-.5-1.1-1.9-.4V6.6l1.9-.4.5-1.1-1-1.7 2-2 1.7 1 1.1-.5z M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  user: 'M8 7.5a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z M2.5 14c0-3 2.4-4.7 5.5-4.7s5.5 1.7 5.5 4.7',
  play: 'M4.5 2.5l9 5.5-9 5.5z',
  pause: 'M5 2.5v11 M11 2.5v11',
  check: 'M2.5 8.5l3.5 3.5 7.5-8',
  close: 'M3 3l10 10 M13 3L3 13',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M10.3 10.3L14 14',
  command:
    'M6 6h4v4H6z M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6 M10 6V4.5A1.5 1.5 0 1 1 11.5 6H10 M6 10v1.5A1.5 1.5 0 1 1 4.5 10H6 M10 10v1.5a1.5 1.5 0 1 0 1.5-1.5H10',
  grip: 'M5.5 4h.01 M10.5 4h.01 M5.5 8h.01 M10.5 8h.01 M5.5 12h.01 M10.5 12h.01',
  chevron: 'M3.5 6l4.5 4.5L12.5 6',
  logout: 'M6.5 2.5h-4v11h4 M6 8h8 M11.5 5L14.5 8l-3 3',
  speaker: 'M2 6h2.5L8 3v10L4.5 10H2z M10.5 5.5a3.5 3.5 0 0 1 0 5 M12.5 3.5a6.5 6.5 0 0 1 0 9',
  'speaker-off': 'M2 6h2.5L8 3v10L4.5 10H2z M10.5 6l4 4 M14.5 6l-4 4',
  orbit:
    'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M1.5 8a6.5 3 -30 1 0 13 0 6.5 3 -30 1 0-13 0z',
  lock: 'M3.5 7.5h9v6h-9z M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5 M13 2.5v3h-3',
  plus: 'M8 3v10 M3 8h10',
} as const;

export type IconName = keyof typeof GLYPHS;

/** Mount once near the root. */
export function IconSprite() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <defs>
        {(Object.keys(GLYPHS) as IconName[]).map((name) => (
          <symbol key={name} id={`oo-i-${name}`} viewBox="0 0 16 16">
            <path
              d={GLYPHS[name]}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Accessible name; omit for decorative icons. */
  title?: string;
}

export function Icon({ name, size = 16, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      <use href={`#oo-i-${name}`} />
    </svg>
  );
}

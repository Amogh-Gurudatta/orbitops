// Canvas-side mirror of the theme.css colour tokens (canvas and ECharts cannot read Tailwind classes).
// Keep in sync with src/styles/theme.css.
export const TOKENS = {
  bg: '#1C1D1B',
  panel: '#242522',
  rule: '#3A3B37',
  grid: '#2E2F2C',
  text: '#D8D6CE',
  text2: '#9A988F',
  textDim: '#62615B',
  trace: '#BEBCB4',
  warning: '#F6574A',
  caution: '#F2A900',
  advisory: '#6FB6C6',
  predicted: '#D04FD0',
  select: '#FFFFFF',
  fontMono: '"B612 Mono", ui-monospace, monospace',
  fontSans: '"B612", ui-sans-serif, sans-serif',
} as const;

/** Greys for multi-series charts where colour must not imply state. */
export const GREY_SERIES = ['#BEBCB4', '#9A988F', '#D8D6CE', '#62615B'] as const;

/** Dark-to-light ramp for heatmaps (value intensity without implying alarm). */
export const GREY_RAMP = [
  '#2E2F2C',
  '#44453F',
  '#62615B',
  '#8A887F',
  '#BEBCB4',
  '#E8E6DE',
] as const;

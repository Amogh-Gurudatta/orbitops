import { describe, expect, it } from 'vitest';
import { makeAlert } from './alertFixtures.ts';
import {
  DEFAULT_FILTERS,
  filtersToParams,
  filtersToQuery,
  matchesFilters,
  parseFilters,
} from './filters.ts';

describe('parseFilters', () => {
  it('reads the lamp links (uppercase severity / subsystem)', () => {
    expect(parseFilters(new URLSearchParams('severity=WARNING')).severity).toBe('WARNING');
    expect(parseFilters(new URLSearchParams('subsystem=EPS')).subsystem).toBe('EPS');
  });

  it('is case-insensitive and ignores junk values', () => {
    const filters = parseFilters(new URLSearchParams('state=ACKED&severity=nope&satId=abc'));
    expect(filters).toEqual({ ...DEFAULT_FILTERS, state: 'acked' });
  });

  it('parses a numeric satId', () => {
    expect(parseFilters(new URLSearchParams('satId=25544')).satId).toBe(25544);
  });
});

describe('filtersToParams', () => {
  it('omits defaults and round-trips', () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
    const filters = { state: 'open', severity: 'CAUTION', subsystem: 'TCS', satId: 7 } as const;
    expect(parseFilters(filtersToParams(filters))).toEqual(filters);
  });
});

describe('filtersToQuery', () => {
  it('sends only what the server can filter on', () => {
    expect(
      filtersToQuery({ state: 'open', severity: 'WARNING', subsystem: 'EPS', satId: 9 }),
    ).toEqual({ state: 'open', severity: 'WARNING', satId: 9 });
    expect(filtersToQuery(DEFAULT_FILTERS)).toEqual({});
  });
});

describe('matchesFilters', () => {
  const alert = makeAlert({
    id: 'a',
    state: 'acked',
    severity: 'WARNING',
    subsystem: 'EPS',
    satId: 5,
  });
  it('applies every dimension, including the client-side subsystem filter', () => {
    expect(matchesFilters(alert, DEFAULT_FILTERS)).toBe(true);
    expect(matchesFilters(alert, { ...DEFAULT_FILTERS, state: 'open' })).toBe(false);
    expect(matchesFilters(alert, { ...DEFAULT_FILTERS, subsystem: 'TCS' })).toBe(false);
    expect(matchesFilters(alert, { ...DEFAULT_FILTERS, subsystem: 'EPS', satId: 5 })).toBe(true);
  });
});

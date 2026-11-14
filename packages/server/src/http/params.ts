// Shared zod building blocks for route params and query strings (everything arrives as a string).
import { z } from 'zod';

const DIGITS = /^\d+$/;

/** A non-negative integer path/query value, e.g. a NORAD id. */
export const SatIdParam = z
  .string()
  .regex(/^\d{1,9}$/, { error: 'must be a non-negative integer' })
  .transform(Number);

/** Integer query value with bounds; absent -> `fallback`. */
export const intQuery = (min: number, max: number, fallback: number) =>
  z
    .string()
    .regex(DIGITS, { error: 'must be a non-negative integer' })
    .transform(Number)
    .pipe(z.int().min(min).max(max))
    .default(fallback);

/** A point in time as epoch milliseconds or an ISO-8601 string; parsed to epoch milliseconds. */
export const TimeMs = z.union([
  z
    .string()
    .regex(/^\d{1,15}$/)
    .transform(Number),
  z.iso.datetime({ offset: true }).transform((iso) => Date.parse(iso)),
]);

/** Comma-separated list -> trimmed, de-duplicated, non-empty strings. */
export const csv = z.string().transform((raw) => [
  ...new Set(
    raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  ),
]);

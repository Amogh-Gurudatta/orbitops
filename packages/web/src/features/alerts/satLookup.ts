// Resolves the SAT filter text (a NORAD id or part of a name) to a satellite id.
import type { Satellite } from '../../api/types.ts';

export function resolveSatId(
  text: string,
  catalog: Readonly<Record<number, Pick<Satellite, 'name'>>>,
): number | null {
  const query = text.trim();
  if (query === '') return null;
  if (/^\d{1,9}$/.test(query)) return Number(query);
  const needle = query.toLowerCase();
  const hit = Object.entries(catalog).find(([, sat]) => sat.name.toLowerCase().includes(needle));
  return hit ? Number(hit[0]) : null;
}

// At boot, finds the newest persisted seq/ts per satellite so samples re-sent after a restart are not stored twice.
import type { TelemetryWriter } from './writer.js';

export interface AggregateSource {
  aggregate(pipeline: object[], options?: object): { toArray(): Promise<unknown[]> };
}

interface MarkRow {
  _id: number;
  seq: number;
  ts: Date;
}

export async function loadBootMarks(
  collection: AggregateSource,
  writer: TelemetryWriter,
): Promise<number> {
  const rows = (await collection
    .aggregate([{ $group: { _id: '$meta.satId', seq: { $max: '$seq' }, ts: { $max: '$ts' } } }], {
      maxTimeMS: 30_000,
    })
    .toArray()) as MarkRow[];
  for (const row of rows) writer.setBootMark(row._id, row.seq, row.ts.getTime());
  return rows.length;
}

// In-memory satellite catalogue (satId -> name/group), loaded from Mongo at boot. Gatekeeps unknown sources.
import type { SatGroup } from '@orbitops/shared';
import { Satellite } from './models/satellite.js';

export interface CatalogEntry {
  satId: number;
  name: string;
  group: SatGroup;
}

export class SatelliteCatalog {
  private readonly entries = new Map<number, CatalogEntry>();

  set(entries: Iterable<CatalogEntry>): void {
    this.entries.clear();
    for (const entry of entries) this.entries.set(entry.satId, entry);
  }

  async load(): Promise<void> {
    const docs = await Satellite.find({}, { satId: 1, name: 1, group: 1, _id: 0 }).lean();
    this.set(docs);
  }

  get = (satId: number): CatalogEntry | undefined => this.entries.get(satId);
  groupOf = (satId: number): SatGroup | undefined => this.entries.get(satId)?.group;
  has = (satId: number): boolean => this.entries.has(satId);
  get size(): number {
    return this.entries.size;
  }
}

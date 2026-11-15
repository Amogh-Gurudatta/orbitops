// Persistence for "has this user seen the tour". One versioned localStorage key per user id; bump the
// version in the key to show a rewritten tour to everyone again. Browsers can block or throw on storage
// access (private mode, site settings), so every access is guarded and falls back to memory for the
// session: the tour then shows at most once per page load instead of failing or nagging on every route.
export type TourOutcome = 'finished' | 'skipped';

export const TOUR_STORAGE_VERSION = 1;

export const tourStorageKey = (userId: string): string =>
  `orbitops.tour.v${TOUR_STORAGE_VERSION}.${userId}`;

type Backing = Pick<Storage, 'getItem' | 'setItem'>;

const isOutcome = (value: unknown): value is TourOutcome =>
  value === 'finished' || value === 'skipped';

export interface TourStorage {
  /** How the user last left the tour, or null if they have never completed or skipped it. */
  read(userId: string): TourOutcome | null;
  write(userId: string, outcome: TourOutcome): void;
}

/** `backing` is a getter so that merely touching `window.localStorage` (which can throw) stays guarded. */
export function createTourStorage(backing: () => Backing): TourStorage {
  const memory = new Map<string, TourOutcome>();
  return {
    read(userId) {
      const key = tourStorageKey(userId);
      try {
        const stored = backing().getItem(key);
        if (isOutcome(stored)) return stored;
      } catch {
        // Storage unavailable: fall through to the in-memory record.
      }
      return memory.get(key) ?? null;
    },
    write(userId, outcome) {
      const key = tourStorageKey(userId);
      memory.set(key, outcome);
      try {
        backing().setItem(key, outcome);
      } catch {
        // Kept in memory only.
      }
    },
  };
}

export const tourStorage = createTourStorage(() => window.localStorage);

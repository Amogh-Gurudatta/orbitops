// What the rest of the app (command palette, user menu, the tooltip) can do with the tour.
import { createContext, use } from 'react';

export interface TourApi {
  /** (Re)starts the tour from the first step, navigating to the fleet page if needed. */
  startTour(): void;
  /** Whether a tour is currently on screen or moving between pages. */
  isActive: boolean;
  next(): void;
  back(): void;
  /** Ends the tour and records it as skipped (or finished, from the last step). */
  skip(): void;
}

export const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const api = use(TourContext);
  if (!api) throw new Error('useTour must be used inside <TourProvider>');
  return api;
}

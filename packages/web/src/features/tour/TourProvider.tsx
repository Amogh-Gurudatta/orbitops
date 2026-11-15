// Owns the onboarding tour. Joyride runs in controlled mode (we hold `run` and `stepIndex`) because the
// tour crosses pages: to move between steps we stop joyride, navigate if the next step lives on another
// route, wait until its target is rendered (skipping the step if it never appears), then set the new index
// and run again. Mounted once inside the authenticated AppShell. The tour starts by itself once after a
// user's first sign-in, and can be relaunched from the palette, the user menu or shift+?.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { ACTIONS, EVENTS, Joyride, type EventData, type Step } from 'react-joyride';
import { useSession } from '../../auth/AuthContext.tsx';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { joyrideFloating, joyrideOptions, joyrideStyles } from './joyrideTheme.ts';
import { buildTourSteps, tourSelector, TOUR_TARGETS } from './steps.ts';
import { TourContext, type TourApi } from './tourContext.ts';
import { tourStorage, type TourOutcome } from './tourStorage.ts';
import { TourTooltip } from './TourTooltip.tsx';
import { waitForElement, waitUntil } from './waitForElement.ts';

/** Time allowed for a lazy-loaded page and its data to render the next target. */
const ROUTE_TARGET_TIMEOUT_MS = 5000;
const SAME_PAGE_TARGET_TIMEOUT_MS = 1200;
const HOME_ROUTE = '/';

type Phase = 'idle' | 'moving' | 'running';
type Direction = 1 | -1;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const fleetSize = useFleetStore((s) => Object.keys(s.catalog).length);
  const reducedMotion = usePrefersReducedMotion();

  const userId = user?.id ?? null;
  const role = user?.role ?? 'viewer';
  const steps = useMemo(() => buildTourSteps(role, fleetSize), [role, fleetSize]);
  const joyrideSteps = useMemo<Step[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        target: step.target ?? 'body',
        placement: step.placement,
        title: step.title,
        content: step.body,
      })),
    [steps],
  );
  const options = useMemo(() => joyrideOptions(reducedMotion), [reducedMotion]);
  const styles = useMemo(joyrideStyles, []);

  const [phase, setPhase] = useState<Phase>('idle');
  const [index, setIndex] = useState(0);

  // Latest values for the async step transition, which outlives the render that started it.
  const live = useRef({ steps, pathname, index, userId });
  live.current = { steps, pathname, index, userId };
  const direction = useRef<Direction>(1);
  const transition = useRef<AbortController | null>(null);

  const end = useCallback((outcome: TourOutcome) => {
    transition.current?.abort();
    transition.current = null;
    setPhase('idle');
    setIndex(0);
    if (live.current.userId) tourStorage.write(live.current.userId, outcome);
  }, []);

  /** Shows step `from`, or the next one in `dir` whose target renders; ends the tour past the last step. */
  const show = useCallback(
    async (from: number, dir: Direction) => {
      transition.current?.abort();
      const controller = new AbortController();
      transition.current = controller;
      direction.current = dir;
      setPhase('moving');

      for (let i = Math.max(from, 0); i < live.current.steps.length; i += dir) {
        const step = live.current.steps[i]!;
        const changesRoute = live.current.pathname !== step.route;
        if (changesRoute) {
          navigate(step.route);
          // Centred steps have no target to wait for, so wait for the router itself.
          await waitUntil(
            () => live.current.pathname === step.route,
            ROUTE_TARGET_TIMEOUT_MS,
            controller.signal,
          );
        }
        const found =
          step.target === null ||
          (await waitForElement(
            step.target,
            changesRoute ? ROUTE_TARGET_TIMEOUT_MS : SAME_PAGE_TARGET_TIMEOUT_MS,
            controller.signal,
          ));
        if (controller.signal.aborted) return;
        if (found) {
          setIndex(i);
          setPhase('running');
          return;
        }
      }
      end('finished');
    },
    [navigate, end],
  );

  const startTour = useCallback(() => void show(0, 1), [show]);
  const next = useCallback(() => void show(live.current.index + 1, 1), [show]);
  const back = useCallback(() => void show(live.current.index - 1, -1), [show]);
  const skip = useCallback(() => end('skipped'), [end]);

  useEffect(() => () => transition.current?.abort(), []);

  // The user left the tour's page on their own (hotkey, link, browser back): end it rather than strand it.
  useEffect(() => {
    if (phase === 'running' && steps[index]?.route !== pathname) end('skipped');
  }, [phase, steps, index, pathname, end]);

  // First sign-in: start once the fleet page has rendered its panels. Never again after finish or skip.
  const catalogLoaded = fleetSize > 0;
  useEffect(() => {
    if (!userId || phase !== 'idle' || !catalogLoaded || pathname !== HOME_ROUTE) return;
    if (tourStorage.read(userId) !== null) return;
    const controller = new AbortController();
    void waitForElement(
      tourSelector(TOUR_TARGETS.fleetTable),
      ROUTE_TARGET_TIMEOUT_MS,
      controller.signal,
    ).then((ready) => {
      if (ready) startTour();
    });
    return () => controller.abort();
  }, [userId, phase, catalogLoaded, pathname, startTour]);

  useHotkeys('shift+?', startTour, {
    useKey: true,
    preventDefault: true,
    enabled: userId !== null,
  });

  const onEvent = useCallback(
    ({ type, action }: EventData) => {
      if (type === EVENTS.STEP_AFTER && action === ACTIONS.CLOSE) end('skipped'); // Esc
      // The target vanished after it was shown (e.g. the window shrank): move on in the same direction.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        void show(live.current.index + direction.current, direction.current);
      }
    },
    [end, show],
  );

  const api = useMemo<TourApi>(
    () => ({ startTour, isActive: phase !== 'idle', next, back, skip }),
    [startTour, phase, next, back, skip],
  );

  return (
    <TourContext value={api}>
      {children}
      {phase !== 'idle' && (
        <Joyride
          run={phase === 'running'}
          stepIndex={index}
          steps={joyrideSteps}
          continuous
          options={options}
          styles={styles}
          floatingOptions={joyrideFloating}
          tooltipComponent={TourTooltip}
          loaderComponent={null}
          onEvent={onEvent}
        />
      )}
    </TourContext>
  );
}

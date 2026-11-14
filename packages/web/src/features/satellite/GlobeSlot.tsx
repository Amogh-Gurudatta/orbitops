// Lazy host for the shared Globe so deck.gl only loads when a page that shows it is opened.
import { lazy, Suspense, type ComponentProps } from 'react';
import { LoadingState } from '../../ui/index.ts';

const Globe = lazy(() => import('../globe/Globe.tsx').then((m) => ({ default: m.Globe })));

export function GlobeSlot(props: ComponentProps<typeof Globe>) {
  return (
    <Suspense fallback={<LoadingState label="LOADING GLOBE" />}>
      <Globe {...props} />
    </Suspense>
  );
}

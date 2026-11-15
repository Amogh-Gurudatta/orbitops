// The tour's tooltip, drawn with the console's own primitives instead of joyride's default: a 1px ruled
// panel, mnemonic title in Barlow Condensed caps, body in B612, "STEP 03 / 11" in B612 Mono and our flat
// Buttons. Joyride supplies the position, ARIA modal flag and the data-action hook it uses to focus the
// primary button; navigation goes through the tour provider because it owns the step index.
import { useId } from 'react';
import type { TooltipRenderProps } from 'react-joyride';
import { Button } from '../../ui/index.ts';
import { stepCounter } from './steps.ts';
import { useTour } from './tourContext.ts';

export function TourTooltip({ index, size, isLastStep, step, tooltipProps }: TooltipRenderProps) {
  const { next, back, skip } = useTour();
  const titleId = useId();
  const bodyId = useId();

  return (
    <div
      {...tooltipProps}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="w-[min(360px,calc(100vw-32px))] border border-rule bg-panel text-text"
    >
      <header className="flex h-3 items-center gap-1 border-b border-rule px-1">
        <h2 id={titleId} className="mnemonic text-sm text-text">
          {step.title}
        </h2>
        <span className="flex-1" />
        <span className="num text-2xs text-text-dim">{stepCounter(index, size)}</span>
      </header>
      <p id={bodyId} className="px-1 py-1 text-sm text-text-2">
        {step.content}
      </p>
      <footer className="flex items-center gap-1 border-t border-rule p-1">
        {!isLastStep && (
          <Button size="sm" variant="ghost" onClick={skip}>
            SKIP TOUR
          </Button>
        )}
        <span className="flex-1" />
        {index > 0 && (
          <Button size="sm" onClick={back}>
            BACK
          </Button>
        )}
        <Button size="sm" variant="primary" data-action="primary" onClick={next}>
          {isLastStep ? 'DONE' : 'NEXT'}
        </Button>
      </footer>
    </div>
  );
}

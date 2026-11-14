// Empty / loading / error states. Text-first, instrument style: a hatched block and a caps status
// line ("ACQUIRING SIGNAL"), never a spinner or an illustration.
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { Button } from './Button.tsx';

function StateFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'flex h-full min-h-12 w-full flex-col items-start justify-center gap-1 p-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({
  label = 'ACQUIRING SIGNAL',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <StateFrame className={className}>
      <div role="status" aria-live="polite" className="flex w-full max-w-40 flex-col gap-0.5">
        <div className="hatch-strong h-2 w-full border border-rule" />
        <span className="mnemonic text-xs text-text-2">{label}…</span>
      </div>
    </StateFrame>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  className,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StateFrame className={className}>
      <span className="mnemonic text-sm text-text-2">{title}</span>
      {detail && <p className="max-w-80 text-xs text-text-dim">{detail}</p>}
      {action}
    </StateFrame>
  );
}

export function ErrorState({
  title = 'DATA LINK FAULT',
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const detail =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return (
    <StateFrame className={className}>
      <div role="alert" className="flex flex-col items-start gap-1">
        <span className="mnemonic text-sm text-warning">{title}</span>
        {detail && <p className="max-w-80 text-xs text-text-2">{detail}</p>}
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            RETRY
          </Button>
        )}
      </div>
    </StateFrame>
  );
}

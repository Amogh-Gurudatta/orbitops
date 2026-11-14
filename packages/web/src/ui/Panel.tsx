// Panel: the only container in the system. A 1px-ruled box with a labelled title bar and an optional
// drag grip (class `panel-drag`, usable as react-grid-layout's draggableHandle). No cards, no shadow.
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './icons.tsx';

export interface PanelProps {
  /** Mnemonic title, rendered in caps. */
  title: string;
  /** Secondary text after the title, e.g. the satellite name. */
  subtitle?: ReactNode;
  /** Right-aligned controls in the title bar (range picker, filters). */
  controls?: ReactNode;
  /** Shows a drag grip and makes the title bar the react-grid-layout handle (`.panel-drag`). */
  draggable?: boolean;
  /** Abnormal state colours the title (and adds a state code for non-colour cues). */
  state?: 'caution' | 'warning';
  /** Remove body padding (tables, charts). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

const STATE_TEXT = { caution: 'text-caution', warning: 'text-warning' } as const;
const STATE_CODE = { caution: 'CAUT', warning: 'WARN' } as const;

export function Panel({
  title,
  subtitle,
  controls,
  draggable,
  state,
  flush,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <section
      className={cx('flex h-full min-h-0 min-w-0 flex-col border border-rule bg-panel', className)}
    >
      <header
        className={cx(
          'flex h-3 shrink-0 items-center gap-1 border-b border-rule pr-1 pl-1',
          draggable && 'panel-drag',
        )}
      >
        {draggable && <Icon name="grip" size={12} className="shrink-0 text-text-dim" />}
        <h2 className={cx('mnemonic text-xs', state ? STATE_TEXT[state] : 'text-text-2')}>
          {title}
        </h2>
        {state && (
          <span className={cx('mnemonic text-2xs', STATE_TEXT[state])}>{STATE_CODE[state]}</span>
        )}
        {subtitle && (
          <span className="min-w-0 flex-1 truncate text-xs text-text-dim">{subtitle}</span>
        )}
        {!subtitle && <span className="flex-1" />}
        {controls && <div className="flex items-center gap-1">{controls}</div>}
      </header>
      <div className={cx('min-h-0 flex-1', !flush && 'p-1', bodyClassName)}>{children}</div>
    </section>
  );
}

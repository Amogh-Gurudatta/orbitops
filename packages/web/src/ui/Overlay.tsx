// Overlays: Tooltip, Dialog (modal) and Menu (dropdown), flat and rule-bordered.
import type { ReactNode } from 'react';
import { Dialog as RadixDialog, DropdownMenu, Tooltip as RadixTooltip } from 'radix-ui';
import { cx } from '../lib/cx.ts';
import { Icon } from './icons.tsx';

/** Mount once at the app root. */
export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({
  content,
  children,
  side = 'bottom',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={4}
          className="z-50 border border-rule bg-panel px-1 py-0.5 text-xs text-text"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <RadixDialog.Content
          className={cx(
            'fixed top-1/4 left-1/2 z-50 w-[min(480px,calc(100vw-32px))] -translate-x-1/2 border border-select bg-panel',
            className,
          )}
        >
          <header className="flex h-3 items-center justify-between border-b border-rule pl-1">
            <RadixDialog.Title className="mnemonic text-xs text-text-2">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="flex h-3 w-3 items-center justify-center text-text-2 hover:text-text"
            >
              <Icon name="close" size={12} />
            </RadixDialog.Close>
          </header>
          <RadixDialog.Description
            className={description ? 'p-1 pb-0 text-xs text-text-2' : 'sr-only'}
          >
            {description ?? title}
          </RadixDialog.Description>
          <div className="p-1">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  children,
  align = 'end',
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-40 border border-select bg-panel"
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: ReactNode;
  onSelect(): void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cx(
        'mnemonic flex h-3 items-center gap-1 px-1 text-xs outline-hidden data-[highlighted]:bg-grid',
        danger ? 'text-warning' : 'text-text-2 data-[highlighted]:text-text',
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="border-b border-rule px-1 py-0.5 text-xs text-text-dim">
      {children}
    </DropdownMenu.Label>
  );
}

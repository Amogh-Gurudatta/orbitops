// Behavioural controls built on Radix: Tabs, SegmentedControl (range pickers), Switch.
import type { ReactNode } from 'react';
import { Switch as RadixSwitch, Tabs as RadixTabs, ToggleGroup } from 'radix-ui';
import { cx } from '../lib/cx.ts';

export const Tabs = RadixTabs.Root;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RadixTabs.List className={cx('flex h-3 border-b border-rule', className)}>
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className="mnemonic h-3 border-b border-transparent px-1.5 text-xs text-text-2 hover:text-text data-[state=active]:border-select data-[state=active]:text-text"
    >
      {children}
    </RadixTabs.Trigger>
  );
}

export const TabsContent = RadixTabs.Content;

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange(value: T): void;
  options: readonly { value: T; label: string }[];
  'aria-label': string;
  className?: string;
}

/** Single-select segmented buttons, e.g. the 15M / 1H / 6H / 24H range picker. */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix emits '' when the active item is clicked again; a range picker must always have a value.
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={rest['aria-label']}
      className={cx('inline-flex border border-rule', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className="mnemonic h-[22px] border-r border-rule px-1 text-xs text-text-dim last:border-r-0 hover:text-text data-[state=on]:bg-text data-[state=on]:text-bg"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  label: string;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="relative h-2 w-4 border border-rule bg-bg data-[state=checked]:border-select"
    >
      <RadixSwitch.Thumb className="mt-[2px] block h-[10px] w-[10px] translate-x-[2px] bg-text-dim data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-select" />
    </RadixSwitch.Root>
  );
}

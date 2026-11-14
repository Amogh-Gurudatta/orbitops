// Form controls: Field (mnemonic label + hint/error), Input, and a Radix-based Select, all flat.
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import { cx } from '../lib/cx.ts';
import { Icon } from './icons.tsx';

export interface FieldProps {
  label: string;
  /** Receives the generated id to wire the label to the control. */
  children: (id: string) => ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}

export function Field({ label, children, hint, error, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <label htmlFor={id} className="mnemonic text-xs text-text-2">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="mnemonic text-xs text-warning">
          {error}
        </p>
      ) : hint ? (
        <p className="text-2xs text-text-dim">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'num h-4 w-full border border-rule bg-bg px-1 text-sm text-text placeholder:text-text-dim',
        'hover:border-text-2 focus-visible:border-select focus-visible:outline-offset-0',
        'disabled:text-text-dim',
        className,
      )}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange(value: string): void;
  options: readonly SelectOption[];
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  className,
  ...rest
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        id={id}
        aria-label={rest['aria-label']}
        className={cx(
          'mnemonic inline-flex h-4 items-center justify-between gap-1 border border-rule bg-bg px-1 text-xs text-text',
          'hover:border-text-2 data-[state=open]:border-select',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <Icon name="chevron" size={12} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={2}
          className="z-50 min-w-(--radix-select-trigger-width) border border-select bg-panel"
        >
          <RadixSelect.Viewport>
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="mnemonic flex h-3 items-center px-1 text-xs text-text-2 outline-hidden data-[highlighted]:bg-grid data-[highlighted]:text-text data-[state=checked]:text-text"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

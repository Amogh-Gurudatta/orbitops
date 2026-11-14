// Keyboard key cap for shortcut hints.
import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-[18px] border border-rule px-0.5 text-center font-mono text-2xs leading-[14px] text-text-2">
      {children}
    </kbd>
  );
}

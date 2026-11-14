// Minimal className joiner: drops falsy parts. Keeps components free of a classnames dependency.
export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}

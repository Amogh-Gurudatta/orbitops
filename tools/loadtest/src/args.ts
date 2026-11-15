// Tiny CLI helper: `--key value` pairs and bare `--flag`s (a flag followed by another `--x` or nothing is `true`).

export type Flags = Record<string, string | boolean | undefined>;

export function parseFlags(argv: string[] = process.argv.slice(2)): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

export function numberFlag(flags: Flags, name: string, fallback: number): number {
  const value = flags[name];
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got "${value}"`);
  return parsed;
}

export function stringFlag(flags: Flags, name: string, fallback: string): string {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}

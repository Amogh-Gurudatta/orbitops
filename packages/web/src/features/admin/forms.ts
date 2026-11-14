// Client-side validation for the admin forms. Mirrors the server's schemas (zod 4) so mistakes are
// caught before the request, and parses the device allowed-sources list.
import { ROLES } from '@orbitops/shared';
import { z } from 'zod';

const CreateUserForm = z.strictObject({
  email: z.email({ error: 'VALID EMAIL REQUIRED' }).max(254, { error: 'TOO LONG' }),
  name: z.string().trim().min(1, { error: 'NAME REQUIRED' }).max(100, { error: 'TOO LONG' }),
  password: z.string().min(8, { error: 'MINIMUM 8 CHARACTERS' }).max(256, { error: 'TOO LONG' }),
  role: z.enum(ROLES),
});

export type CreateUserFields = z.input<typeof CreateUserForm>;
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type FormResult<T, K extends string> =
  { ok: true; value: T } | { ok: false; errors: FieldErrors<K> };

export function validateCreateUser(
  raw: Record<keyof CreateUserFields, string>,
): FormResult<z.output<typeof CreateUserForm>, keyof CreateUserFields> {
  const parsed = CreateUserForm.safeParse({ ...raw, email: raw.email.trim() });
  if (parsed.success) return { ok: true, value: parsed.data };
  const fieldErrors = z.flattenError(parsed.error).fieldErrors as Partial<
    Record<keyof CreateUserFields, string[]>
  >;
  const errors: FieldErrors<keyof CreateUserFields> = {};
  for (const [field, messages] of Object.entries(fieldErrors))
    errors[field as keyof CreateUserFields] = messages[0];
  return { ok: false, errors };
}

const SourceList = z.array(z.string().min(1).max(32)).min(1).max(100);

/** `"sat-25544, sat-43013"` -> ids; blank means every source (`*`). */
export function parseAllowedSources(text: string): FormResult<string[], 'sources'> {
  const items = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parsed = SourceList.safeParse(items.length === 0 ? ['*'] : items);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: { sources: '1-100 SOURCE IDS, EACH UP TO 32 CHARACTERS' } };
}

/** MongoDB ObjectIds embed their creation time in the first four bytes (seconds since epoch). */
export function objectIdTime(id: string): number | null {
  return /^[0-9a-f]{24}$/i.test(id) ? parseInt(id.slice(0, 8), 16) * 1000 : null;
}

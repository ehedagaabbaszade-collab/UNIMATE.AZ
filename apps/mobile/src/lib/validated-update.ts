import type { z } from "zod";

/**
 * Applies `fn` and returns the result only if it still matches `schema`; otherwise keeps `prev`.
 * Reads fall back to empty on a bad shape, so persisting an invalid value would wipe the user's data on next launch.
 */
export function validatedUpdate<T>(schema: z.ZodType<T>, prev: T, fn: (prev: T) => T): { value: T; ok: boolean } {
  const next = fn(prev);
  return schema.safeParse(next).success ? { value: next, ok: true } : { value: prev, ok: false };
}

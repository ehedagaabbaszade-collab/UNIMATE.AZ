import type { MessageKey } from "@unimate/i18n";
import { z } from "zod";
import { isHttpsUrl } from "./schemas";

/**
 * system_config keys this console knows how to edit, each with a strict schema. The database only enforces the key
 * pattern and "non-null JSON, <= 20 KB"; the schema here is the validation layer. Unknown keys are listed read-only.
 * NOTE: declaring a key here does not make any runtime read it: consumers must be wired separately.
 */
export const CONFIG_KEYS = {
  "maintenance.mode": { schema: z.object({ enabled: z.boolean(), message_key: z.string().trim().max(80).optional() }).strict(), desc: "admin.config.descMaintenance", example: '{"enabled":false}' },
  "signup.enabled": { schema: z.boolean(), desc: "admin.config.descSignup", example: "true" },
  "uploads.max_file_mb": { schema: z.number().int().min(1).max(200), desc: "admin.config.descUploads", example: "25" },
  "support.contact_url": { schema: z.string().refine(isHttpsUrl), desc: "admin.config.descSupport", example: '"https://example.az/help"' },
} as const satisfies Record<string, { schema: z.ZodType; desc: MessageKey; example: string }>;
export type ConfigKey = keyof typeof CONFIG_KEYS;
export const KNOWN_KEYS = Object.keys(CONFIG_KEYS) as ConfigKey[];
export const isKnownKey = (k: string): k is ConfigKey => Object.hasOwn(CONFIG_KEYS, k);

export type ConfigParse = { ok: true; value: unknown } | { ok: false; error: MessageKey };
/** Parses the editor text as JSON and validates it against the key's schema. Never throws. */
export function parseConfigValue(key: string, text: string): ConfigParse {
  if (!isKnownKey(key)) return { ok: false, error: "admin.config.errUnknownKey" };
  if (new TextEncoder().encode(text).length > 20000) return { ok: false, error: "admin.config.errValue" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "admin.config.errJson" };
  }
  const r = CONFIG_KEYS[key].schema.safeParse(json);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: "admin.config.errValue" };
}

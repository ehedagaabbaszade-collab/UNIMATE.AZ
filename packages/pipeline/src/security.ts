import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (both sides are hashed first, so length differences do not leak either). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Parses the comma-separated ALLOWED_ORIGIN env var. Throws when unset/empty/"*": there is no permissive default. */
export function parseAllowedOrigin(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  if (!v || v === "*" || v.includes("*")) throw new Error("ALLOWED_ORIGIN must be set to an explicit origin (no wildcard)");
  try {
    const u = new URL(v);
    if (u.origin !== v.replace(/\/$/, "")) throw new Error("not an origin");
    return u.origin;
  } catch {
    throw new Error("ALLOWED_ORIGIN must be a single origin such as https://app.example.com");
  }
}

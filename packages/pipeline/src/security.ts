import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (both sides are hashed first, so length differences do not leak either). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Parses the comma-separated ALLOWED_ORIGIN env var into exact origins. Throws when unset/empty/wildcard/invalid: no permissive default. */
export function parseAllowedOrigins(value: string | undefined | null): string[] {
  const parts = (value ?? "").split(",").map((p) => p.trim());
  if (parts.some((v) => !v || v.includes("*"))) throw new Error("ALLOWED_ORIGIN must be a comma-separated list of explicit origins (no wildcard, no empty entries)");
  const out = parts.map((v) => {
    try {
      const u = new URL(v);
      if (u.origin !== v.replace(/\/$/, "")) throw new Error("not an origin");
      return u.origin;
    } catch {
      throw new Error("ALLOWED_ORIGIN entries must be origins such as https://app.example.com");
    }
  });
  return [...new Set(out)];
}

/** Single-origin variant (kept for compatibility): throws unless exactly one origin is given. */
export function parseAllowedOrigin(value: string | undefined | null): string {
  const o = parseAllowedOrigins(value);
  if (o.length !== 1) throw new Error("ALLOWED_ORIGIN must be a single origin such as https://app.example.com");
  return o[0]!;
}

/** Echoes the request Origin only when it is exactly allowed; otherwise the first allowed origin. Never "*". */
export function corsOriginFor(requestOrigin: string | null, allowed: readonly string[]): string {
  return requestOrigin !== null && allowed.includes(requestOrigin) ? requestOrigin : allowed[0]!;
}

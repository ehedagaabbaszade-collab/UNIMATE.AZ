import type { MessageKey } from "@unimate/i18n";

/** Pure helpers for the AI config / cost screens. Prices are integer micro-USD per 1,000,000 tokens (1 USD = 1,000,000). */
export const MICRO = 1_000_000;
export const AI_TASKS = ["extract_cleanup", "summarize", "rag", "chat", "quiz", "flashcards", "exam_simulation", "embed", "cv_feedback", "interview_prep"] as const;
export type AiTask = (typeof AI_TASKS)[number];
export const AI_PLANS = ["free", "plus", "pro"] as const;
export const AI_TIERS = ["small", "standard", "premium"] as const;
export type AiTier = (typeof AI_TIERS)[number];
export const TIER_RANK: Record<AiTier, number> = { small: 1, standard: 2, premium: 3 };
export const PROVIDER_KINDS = ["openai", "anthropic"] as const;
/** Documentation only: which environment variable NAMES the pipeline reads. Never a value, never stored by this app. */
/** Documentation only: the conventional variable NAME for a provider kind (built from the kind, never a value). */
export const providerEnvName = (kind: (typeof PROVIDER_KINDS)[number]): string => `${kind.toUpperCase()}_API_KEY`;

/** "1.25" -> 1_250_000. Plain decimals with up to 6 places only (no exponent, sign or separators); null when invalid. */
export function parseUsdToMicro(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * MICRO + Number(frac.padEnd(6, "0"));
}
/** Micro-USD -> plain decimal string, at least 2 decimals, trailing zeros trimmed beyond that ("1.25", "0.00015"). */
export function microToUsdString(micro: number): string {
  const whole = Math.trunc(micro / MICRO);
  const frac = String(micro % MICRO).padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${frac.padEnd(2, "0")}`;
}
export const formatUsd = (micro: number): string => `$${microToUsdString(micro)}`;

/** Used share of a hard limit in percent (2 decimals); null when the limit is 0 (blocks everything). */
export function utilisationPct(spent: number, reserved: number, limit: number): number | null {
  if (limit <= 0) return null;
  return Math.round(((spent + reserved) / limit) * 10000) / 100;
}
export type MeterTone = "success" | "warning" | "danger";
export const meterTone = (pct: number | null): MeterTone => (pct === null || pct >= 90 ? "danger" : pct >= 70 ? "warning" : "success");
export const ratePct = (part: number, total: number): number => (total <= 0 ? 0 : Math.round((part / total) * 1000) / 10);

export interface ModelLite {
  id: string;
  model: string;
  tier: AiTier;
  input_micro_usd_per_mtok: number;
  output_micro_usd_per_mtok: number;
  cached_input_micro_usd_per_mtok: number;
  enabled: boolean;
  approved_fallback: boolean;
}
/** Mirrors ai_validate_routes + admin_set_ai_route. The database re-checks everything; this is instant feedback. */
export function routeIssues(primary: ModelLite | undefined, fallbacks: ModelLite[]): MessageKey[] {
  const out: MessageKey[] = [];
  if (!primary) return ["admin.routes.errPrimary"];
  if (!primary.enabled) out.push("admin.routes.errDisabled");
  if (new Set(fallbacks.map((f) => f.id)).size !== fallbacks.length) out.push("admin.routes.errDuplicate");
  for (const f of fallbacks) {
    if (f.id === primary.id) out.push("admin.routes.errSame");
    if (!f.enabled) out.push("admin.routes.errDisabled");
    if (!f.approved_fallback) out.push("admin.routes.errNotApproved");
    if (
      f.input_micro_usd_per_mtok > primary.input_micro_usd_per_mtok ||
      f.output_micro_usd_per_mtok > primary.output_micro_usd_per_mtok ||
      f.cached_input_micro_usd_per_mtok > primary.cached_input_micro_usd_per_mtok ||
      TIER_RANK[f.tier] > TIER_RANK[primary.tier]
    )
      out.push("admin.routes.errCostlier");
  }
  return [...new Set(out)];
}

type Entity = "providers" | "models" | "routes" | "budgets";
export type Snapshot = Partial<Record<Entity, Array<Record<string, unknown>>>>;
export interface DiffEntry {
  entity: Entity;
  id: string;
  change: "added" | "removed" | "changed";
  fields: string[];
}
const ENTITIES: readonly Entity[] = ["providers", "models", "routes", "budgets"];
const NOISE = new Set(["updated_at", "created_at"]);
/** What changed between two config snapshots (by row id). With no previous snapshot nothing is reported. */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): DiffEntry[] {
  if (!prev) return [];
  const out: DiffEntry[] = [];
  for (const entity of ENTITIES) {
    const a = new Map((prev[entity] ?? []).map((r) => [String(r.id), r]));
    const b = new Map((next[entity] ?? []).map((r) => [String(r.id), r]));
    for (const [id, row] of b) {
      const old = a.get(id);
      if (!old) {
        out.push({ entity, id, change: "added", fields: [] });
        continue;
      }
      const fields = Object.keys({ ...old, ...row }).filter((k) => !NOISE.has(k) && JSON.stringify(old[k]) !== JSON.stringify(row[k]));
      if (fields.length > 0) out.push({ entity, id, change: "changed", fields: fields.sort() });
    }
    for (const id of a.keys()) if (!b.has(id)) out.push({ entity, id, change: "removed", fields: [] });
  }
  return out;
}

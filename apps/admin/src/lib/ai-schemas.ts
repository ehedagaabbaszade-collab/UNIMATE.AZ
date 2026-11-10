import { z } from "zod";
import { AI_PLANS, AI_TASKS, AI_TIERS, PROVIDER_KINDS, parseUsdToMicro } from "./ai-config";

/** Form schemas for the AI config screens. Messages are i18n keys; they mirror the admin_ai_set_* RPC checks. */
const uuid = z.string().uuid("admin.common.fieldRequired");
const usd = (allowZero: boolean) =>
  z.string().transform((v, ctx) => {
    const m = parseUsdToMicro(v);
    if (m === null || (!allowZero && m === 0)) {
      ctx.addIssue({ code: "custom", message: "admin.models.errPrice" });
      return z.NEVER;
    }
    return m;
  });
const flag = z.boolean();

export const providerSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9_.-]{1,60}$/, "admin.providers.errName"),
  kind: z.enum(PROVIDER_KINDS),
  enabled: flag,
  // A short label, never a URL or anything credential-like (mirrors admin_set_ai_provider).
  baseUrlLabel: z
    .string()
    .trim()
    .max(100, "admin.providers.errLabel")
    .refine((v) => !/(:\/\/|@|key|secret|token)/i.test(v), "admin.providers.errLabel")
    .transform((v) => (v ? v : null)),
});

export const modelSchema = z
  .object({
    providerId: uuid,
    model: z.string().trim().min(1, "admin.common.fieldRequired").max(200, "admin.common.fieldTooLong"),
    tier: z.enum(AI_TIERS),
    input: usd(false),
    output: usd(true),
    cached: usd(true),
    maxOutputTokens: z.coerce.number().int("admin.models.errTokens").min(1, "admin.models.errTokens").max(1_000_000, "admin.models.errTokens"),
    enabled: flag,
    approvedFallback: flag,
  })
  .superRefine((v, ctx) => {
    if (v.cached > v.input) ctx.addIssue({ code: "custom", path: ["cached"], message: "admin.models.errCached" });
  });

export const routeSchema = z.object({
  task: z.enum(AI_TASKS),
  plan: z.enum(AI_PLANS),
  primary: uuid,
  fallbacks: z.array(uuid).max(5, "admin.routes.errTooMany"),
  rateLimit: z.coerce.number().int("admin.routes.errRate").min(1, "admin.routes.errRate").max(100000, "admin.routes.errRate"),
});

/** Budget key: '*' for global and per-user default, a plan name for plan scope, or a user uuid for a single user. */
export const budgetSchema = z
  .object({
    scope: z.enum(["user", "plan", "global"]),
    key: z.string().trim(),
    period: z.enum(["day", "month"]),
    limit: z.string().transform((v, ctx) => {
      const m = parseUsdToMicro(v);
      if (m === null) {
        ctx.addIssue({ code: "custom", message: "admin.budgets.errLimit" });
        return z.NEVER;
      }
      return m;
    }),
  })
  .superRefine((v, ctx) => {
    const ok = v.scope === "global" ? v.key === "*" : v.scope === "plan" ? (AI_PLANS as readonly string[]).includes(v.key) : v.key === "*" || z.string().uuid().safeParse(v.key).success;
    if (!ok) ctx.addIssue({ code: "custom", path: ["key"], message: "admin.budgets.errKey" });
  });

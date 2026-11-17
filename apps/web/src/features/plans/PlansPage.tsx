"use client";

import { PLANS, PRICE_AZN, type PlanId } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Card, Skeleton } from "@unimate/ui";
import { useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { planFromSubscription } from "@/lib/usage";
import { useAsync } from "@/lib/use-async";
import { useDemoPlan } from "./demo-plan";
import { planRelation } from "./plan-relation";
import s from "./PlansPage.module.css";

const SHOWN = ["FREE", "PLUS", "PRO"] as const satisfies readonly PlanId[];
const FEATURES = ["flashcards", "quiz", "ocr", "export", "priority_models"] as const;

/** Plans and limits come from @unimate/core billing. Payment is a demo simulation on mobile; the web app only shows plans and the current plan. */
export function PlansPage() {
  const { t, number } = useI18n();
  const user = useUser();
  const current = useAsync(async () => {
    const plan = await getBrowserClient().rpc("my_plan");
    return planFromSubscription(plan.error ? null : { plan: String(plan.data ?? "free") as "free" | "plus" | "pro", status: "active" });
  }, [user.id]);
  const demo = useDemoPlan(user.id);
  const plan = current.data ? (demo.demoPlan ?? current.data) : null;
  const [picked, setSelected] = useState<PlanId | null>(null);
  const selected = picked ?? (plan ? (SHOWN.find((id) => planRelation(plan, id) === "upgrade") ?? "PLUS") : "PLUS");

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("mobile.profile.plans.title")}</h1>
      </div>
      {demo.demoPlan ? (
        <div className="row">
          <span className="um-hint">{t("mobile.profile.plans.demoNotice", { plan: t(`mobile.profile.plans.name.${demo.demoPlan}`) })}</span>
          <button type="button" className={s.linkBtn} onClick={demo.clear}>{t("mobile.profile.plans.demoReset")}</button>
        </div>
      ) : null}
      {current.loading && !current.data ? <Skeleton height={160} /> : null}
      {SHOWN.map((id) => {
        const lim = PLANS[id];
        const price = PRICE_AZN[id];
        const open = id === selected;
        const isCurrent = plan !== null && planRelation(plan, id) === "current";
        const features = [
          t("mobile.profile.plans.ai", { n: number(lim.aiMessagesPerDay) }),
          t("mobile.profile.plans.docs", { n: number(lim.docsPerMonth) }),
          t("mobile.profile.plans.pages", { n: number(lim.maxPages) }),
          ...FEATURES.filter((f) => lim.features.includes(f)).map((f) => t(`mobile.profile.plans.feat.${f}`)),
        ];
        return (
          <Card key={id} className={open ? s.open : undefined}>
            <div className={s.plan}>
              <button type="button" className={s.linkBtn} aria-expanded={open} onClick={() => setSelected(id)} style={{ textAlign: "start" }}>
                <span className="row">
                  <h2>{t(`mobile.profile.plans.name.${id}`)}</h2>
                  {id === "PLUS" ? <Badge tone="primary">{t("mobile.profile.subscription.recommended")}</Badge> : null}
                  {isCurrent ? <Badge>{t("mobile.profile.plans.current")}</Badge> : null}
                </span>
              </button>
              <div className={s.price}>
                {t("mobile.profile.plans.price", { amount: number(price, { minimumFractionDigits: price ? 2 : 0, maximumFractionDigits: 2 }) })}{" "}
                <small className="um-hint">{price ? t("mobile.profile.plans.perMonth") : t("mobile.profile.plans.free")}</small>
              </div>
              {open ? (
                <ul className={s.features}>
                  {features.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

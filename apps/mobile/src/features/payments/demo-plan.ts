import type { PlanId } from "@unimate/core";
import { z } from "zod";
import { useLocalValue } from "../../lib/local-store";

const schema = z.enum(["FREE", "PLUS", "PRO"]).nullable();
export type DemoPlan = z.infer<typeof schema>;

/** The plan the UI shows: the device-local demo plan if set, else the server plan. Server quotas never follow the demo plan. */
export const effectivePlan = (demo: DemoPlan, server: PlanId): PlanId => demo ?? server;

/** Device-only demo plan (payments are a simulation; the client cannot change subscriptions). */
export function useDemoPlan(uid: string) {
  const s = useLocalValue(`um.demoPlan.${uid}`, schema, null);
  return {
    demoPlan: s.value,
    ready: s.ready,
    setDemoPlan: (p: PlanId) => void s.update(() => p as DemoPlan), // schema rejects non-demo plans (GROUP)
    clear: () => void s.update(() => null),
    reload: s.reload,
  };
}

export function useEffectivePlan(uid: string, serverPlan: PlanId | undefined): PlanId | undefined {
  const { demoPlan } = useDemoPlan(uid);
  return serverPlan === undefined ? demoPlan ?? undefined : effectivePlan(demoPlan, serverPlan);
}

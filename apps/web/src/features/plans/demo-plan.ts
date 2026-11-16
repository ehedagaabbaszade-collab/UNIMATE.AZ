"use client";

import type { PlanId } from "@unimate/core";
import { z } from "zod";
import { useLocalValue } from "@/lib/local-value";

const schema = z.enum(["FREE", "PLUS", "PRO"]).nullable();
export type DemoPlan = z.infer<typeof schema>;

/** The plan the UI shows: the browser-local demo plan if set, else the server plan. Server quotas never follow the demo plan. */
export const effectivePlan = (demo: DemoPlan, server: PlanId): PlanId => demo ?? server;

/** Browser-only demo plan (same key as mobile; payments are a simulation, the client cannot change subscriptions). */
export function useDemoPlan(uid: string) {
  const s = useLocalValue(`um.demoPlan.${uid}`, schema, null);
  return { demoPlan: s.value, ready: s.ready, clear: () => void s.update(() => null) };
}

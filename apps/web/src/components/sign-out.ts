"use client";

import { useRouter } from "next/navigation";
import { clearSchedule } from "@/features/planner/offline-cache";
import type { AppMode } from "@/lib/mode";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useUser } from "./user";

/** One sign-out for the sidebar and the Profile page. */
export function useSignOut(mode: AppMode = "student") {
  const router = useRouter();
  const user = useUser();
  return async function signOut() {
    await clearSchedule(user.id); // do not leave one user's schedule on a shared device
    await getBrowserClient().auth.signOut();
    router.replace(mode === "teacher" ? "/sign-in?as=teacher" : "/sign-in");
    router.refresh();
  };
}

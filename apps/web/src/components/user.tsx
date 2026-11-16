"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppMode } from "@/lib/mode";

export interface CurrentUser {
  id: string;
  email: string | null;
  displayName: string | null;
}
const Ctx = createContext<CurrentUser | null>(null);

export function UserProvider({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
const ModeCtx = createContext<AppMode>("student");
/** The portal mode the server resolved for this request (no post-mount flash). */
export const ModeProvider = ModeCtx.Provider;
export const useAppMode = (): AppMode => useContext(ModeCtx);
export const useOptionalUser = (): CurrentUser | null => useContext(Ctx);
export function useUser(): CurrentUser {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUser must be used inside <UserProvider>");
  return u;
}

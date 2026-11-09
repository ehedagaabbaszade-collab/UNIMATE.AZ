"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface CurrentUser {
  id: string;
  email: string | null;
  displayName: string | null;
}
const Ctx = createContext<CurrentUser | null>(null);

export function UserProvider({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
export function useUser(): CurrentUser {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUser must be used inside <UserProvider>");
  return u;
}

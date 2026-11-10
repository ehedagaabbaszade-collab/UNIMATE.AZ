"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StaffRole } from "../lib/guard";

export interface StaffUser {
  id: string;
  role: StaffRole;
  displayName: string | null;
  email: string | null;
}
const Ctx = createContext<StaffUser | null>(null);
export function StaffProvider({ user, children }: { user: StaffUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
export const useOptionalStaff = (): StaffUser | null => useContext(Ctx);
export function useStaff(): StaffUser {
  const u = useContext(Ctx);
  if (!u) throw new Error("useStaff must be used inside <StaffProvider>");
  return u;
}

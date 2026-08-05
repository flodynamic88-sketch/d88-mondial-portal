"use client";

import { createContext, useContext } from "react";
import type { UserRole } from "./types";

const RoleContext = createContext<UserRole>("admin");

export function RoleProvider({
  role,
  children,
}: {
  role: UserRole;
  children: React.ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** Returns the current signed-in user's role anywhere inside AppShell. */
export function useRole(): UserRole {
  return useContext(RoleContext);
}

"use client";

import { createContext, useContext } from "react";
import type { UserProfile } from "@/types/database";

const AuthContext = createContext<UserProfile | null>(null);

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({
  profile,
  children,
}: {
  profile: UserProfile | null;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={profile}>{children}</AuthContext.Provider>;
}

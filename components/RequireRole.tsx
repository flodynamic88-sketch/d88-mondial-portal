"use client";

import { useAuth } from "@/components/AuthProvider";
import type { UserRole } from "@/types/database";

export default function RequireRole({
  roles,
  children,
}: {
  roles: UserRole[];
  children: React.ReactNode;
}) {
  const profile = useAuth();

  if (!profile || !roles.includes(profile.role)) {
    return (
      <div className="card mt-6 text-sm text-gray-500">
        Wala kang access sa page na ito. Kung sa tingin mo ay dapat may access ka, i-contact ang
        Admin.
      </div>
    );
  }

  return <>{children}</>;
}

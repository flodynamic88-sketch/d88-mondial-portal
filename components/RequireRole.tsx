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
        You don't have access to this page. If you think you should have access, please contact
        an Admin.
      </div>
    );
  }

  return <>{children}</>;
}

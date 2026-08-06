import { Suspense } from "react";
import RoutePlanBoard from "@/components/RoutePlanBoard";
import RequireRole from "@/components/RequireRole";

export default function RoutePlanPage() {
  return (
    <RequireRole
      roles={[
        "ADMIN",
        "LOGISTICS_OFFICER",
        "JMD_PLANNER",
        "LOGISTICS_ASSOCIATE",
        "GENERAL_MANAGER",
        "JMD_ADMIN",
      ]}
    >
      {/* RoutePlanBoard reads ?planId= (via useSearchParams) to support the
          Delivery Variance Log's trace-back link -- Next.js requires a
          Suspense boundary around any component using that hook. */}
      <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
        <RoutePlanBoard />
      </Suspense>
    </RequireRole>
  );
}

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
      <RoutePlanBoard />
    </RequireRole>
  );
}

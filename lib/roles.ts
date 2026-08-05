import type { UserRole } from "@/types/database";

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin (Logistics Manager)",
  LOGISTICS_OFFICER: "Logistics Officer",
  JMD_PLANNER: "JMD Planner",
  MONDIAL_TEAM: "Mondial Team",
  LOGISTICS_ASSOCIATE: "Logistics Associate",
  GENERAL_MANAGER: "General Manager",
  INVOICING_TEAM: "Invoicing Team",
  JMD_ADMIN: "JMD Admin",
};

export const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "LOGISTICS_OFFICER",
  "JMD_PLANNER",
  "MONDIAL_TEAM",
  "LOGISTICS_ASSOCIATE",
  "GENERAL_MANAGER",
  "INVOICING_TEAM",
  "JMD_ADMIN",
];

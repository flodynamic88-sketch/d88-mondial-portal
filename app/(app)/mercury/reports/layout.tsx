"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const REPORT_TABS = [
  { href: "/mercury/reports/monthly-sales", label: "Monthly Sales" },
  { href: "/mercury/reports/branch-sales", label: "Branch Sales" },
  { href: "/mercury/reports/branch-performance", label: "Branch Performance" },
  { href: "/mercury/reports/year-view", label: "Year View" },
  { href: "/mercury/reports/items-delivered-summary", label: "Items Delivered Summary" },
  { href: "/mercury/reports/sales-report", label: "Sales Report (Client)" },
  { href: "/mercury/reports/inventory-report", label: "Inventory Report (Client)" },
  { href: "/mercury/reports/bad-order-report", label: "Bad Order Report (Client)" },
];

export default function MercuryReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap gap-2 border-b border-gray-200 pb-4">
        {REPORT_TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`tab-button ${active ? "tab-button-active" : "tab-button-inactive"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}

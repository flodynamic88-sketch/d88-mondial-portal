/**
 * Color coding for status badges shown across the Deliveries and Billing
 * pages. Keeping this in one place means every screen (list, detail, print)
 * stays visually consistent.
 */

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  "In-Transit": "bg-blue-100 text-blue-700",
  Delivered: "bg-green-100 text-green-700",
  "Delivered-Late": "bg-orange-100 text-orange-700",
  Cancelled: "bg-red-100 text-red-700",
  Returned: "bg-purple-100 text-purple-700",
};

export function deliveryStatusBadgeClass(status: string | null | undefined): string {
  return DELIVERY_STATUS_COLORS[status || ""] || "bg-gray-100 text-gray-700";
}

const BILLING_STATUS_COLORS: Record<string, string> = {
  Unpaid: "bg-red-100 text-red-700",
  Billed: "bg-indigo-100 text-indigo-700",
  "For Checking": "bg-yellow-100 text-yellow-800",
  "Partially Paid": "bg-blue-100 text-blue-700",
  Paid: "bg-green-100 text-green-700",
  Disputed: "bg-orange-100 text-orange-700",
};

export function billingStatusBadgeClass(status: string | null | undefined): string {
  return BILLING_STATUS_COLORS[status || ""] || "bg-gray-100 text-gray-700";
}

const TRANSACTION_TYPE_COLORS: Record<string, string> = {
  Delivery: "bg-gray-100 text-gray-700",
  Pickup: "bg-teal-100 text-teal-700",
};

export function transactionTypeBadgeClass(type: string | null | undefined): string {
  return TRANSACTION_TYPE_COLORS[type || ""] || "bg-gray-100 text-gray-700";
}

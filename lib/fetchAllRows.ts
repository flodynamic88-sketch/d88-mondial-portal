import type { PostgrestError } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

// Supabase (PostgREST) caps any unranged `.select()` at a server-configured
// max -- 1000 rows on this project. Once a billing-critical table/view
// (v_billing, v_final_billing, mondial_confirmations, ...) grows past that
// cap, a plain `.select("*")` doesn't error -- it silently returns only the
// first page, so with `.order("delivered_at", { ascending: true })` the
// newest invoices (the ones a transmittal was *just* generated for) are the
// ones that quietly disappear from Mondial Confirmation / Final Billing.
// This is exactly the "invoice is in the transmittal but not in Mondial
// Confirmation" symptom Mondial reported. Use this helper for any list
// fetch from those tables/views instead of a bare `.select()` so growth
// past 1000 rows can never drop data again.
export async function fetchAllRows<T>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (data && data.length > 0) all.push(...data);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: all, error: null };
}

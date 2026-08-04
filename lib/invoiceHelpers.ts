import { createClient } from "@/lib/supabase/client";
import type { ReasonType } from "@/types/database";

/**
 * Finds an existing company by exact (case-insensitive) name match, or
 * creates a new one. Returns the company id, or null if the name is blank
 * or the operation fails (caller should fall back to company_name_raw only).
 */
export async function findOrCreateCompany(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const supabase = createClient();

  try {
    const { data: existing } = await supabase
      .from("companies")
      .select("id")
      .ilike("name", trimmed)
      .limit(1)
      .maybeSingle();

    if (existing?.id) return existing.id;

    const { data: created, error: insertError } = await supabase
      .from("companies")
      .insert({ name: trimmed })
      .select("id")
      .single();

    if (insertError) return null;
    return created?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Finds an existing branch address by exact (case-insensitive) match, or
 * creates a new one for future autocomplete. Best-effort: failures are
 * swallowed since branch_addresses is only a reference/autocomplete table.
 */
export async function findOrCreateBranchAddress(
  address: string,
  companyId: string | null
): Promise<void> {
  const trimmed = address.trim();
  if (!trimmed) return;

  const supabase = createClient();

  try {
    const { data: existing } = await supabase
      .from("branch_addresses")
      .select("id")
      .ilike("address", trimmed)
      .limit(1)
      .maybeSingle();

    if (existing?.id) return;

    await supabase
      .from("branch_addresses")
      .insert({ address: trimmed, company_id: companyId });
  } catch {
    // Non-fatal: autocomplete reference data only.
  }
}

/**
 * Finds an existing delivery reason by type + exact (case-insensitive) label
 * match, or creates a new one so it becomes available in the dropdown going
 * forward. Returns the reason id, or null if the label is blank or the
 * operation fails.
 */
export async function findOrCreateDeliveryReason(
  type: ReasonType,
  label: string,
  options?: { chargeableToMondial?: boolean; isD88Error?: boolean }
): Promise<string | null> {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const supabase = createClient();

  try {
    const { data: existing } = await supabase
      .from("delivery_reasons")
      .select("id")
      .eq("type", type)
      .ilike("label", trimmed)
      .limit(1)
      .maybeSingle();

    if (existing?.id) return existing.id;

    const { data: created, error: insertError } = await supabase
      .from("delivery_reasons")
      .insert({
        type,
        label: trimmed,
        chargeable_to_mondial: options?.chargeableToMondial ?? false,
        is_d88_error: options?.isD88Error ?? false,
      })
      .select("id")
      .single();

    if (insertError) return null;
    return created?.id ?? null;
  } catch {
    return null;
  }
}

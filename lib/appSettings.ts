import { createClient } from "@/lib/supabase/client";

/** Key used in app_settings for the Dynamic88 logo shown on printable forms. */
export const LOGO_SETTING_KEY = "dynamic88_logo";

/** Key used in app_settings for the recipient email of auto-sent Final Billing reports. */
export const FINAL_BILLING_REPORT_EMAIL_KEY = "final_billing_report_email";

/** Reads a single app_settings value (e.g. the stored logo data URL). */
export async function getAppSetting(key: string): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value ?? null;
  } catch {
    return null;
  }
}

/** Upserts a single app_settings value. Admin-only per RLS. */
export async function setAppSetting(key: string, value: string | null): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return !error;
  } catch {
    return false;
  }
}

// One-off script: creates the very first ADMIN account for Mondial Portal.
//
// Why this exists: the in-app "User Management" page only works once you're
// already logged in as an ADMIN, so the first account has to be created
// directly against Supabase using the service role key.
//
// Usage (from the project root, with your .env.local already filled in):
//   node scripts/seed-admin.mjs
//
// Safe to re-run: if an ADMIN account already exists, it prints that
// account's username and exits without creating a duplicate.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// Load .env.local manually so this works with a plain `node` call.
function loadEnvLocal() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(dir, "..", ".env.local");
  try {
    const contents = readFileSync(envPath, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local not found — assume env vars are already set some other way.
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const username = "admin";
const password = randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
const email = `${username}@d88-mondial.internal`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existing, error: existingErr } = await supabase
    .from("user_profiles")
    .select("username, role")
    .eq("role", "ADMIN")
    .limit(1);

  if (existingErr) {
    console.error("Could not check for existing admin:", existingErr.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log(`An ADMIN account already exists: username "${existing[0].username}".`);
    console.log("No new account was created.");
    return;
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    console.error("Failed to create auth user:", createErr?.message);
    process.exit(1);
  }

  const { error: profileErr } = await supabase.from("user_profiles").insert({
    id: created.user.id,
    username,
    full_name: "Administrator",
    role: "ADMIN",
  });

  if (profileErr) {
    console.error("Failed to create user_profiles row, rolling back auth user:", profileErr.message);
    await supabase.auth.admin.deleteUser(created.user.id);
    process.exit(1);
  }

  console.log("Admin account created successfully:");
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
  console.log("\nSave this password now — it will not be shown again. You can change it later from the User Management page once logged in.");
}

main();

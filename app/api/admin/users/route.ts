import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { usernameToEmail, isValidUsername, USERNAME_FORMAT_HINT } from "@/lib/authUsername";
import { ALL_ROLES } from "@/lib/roles";
import type { UserRole } from "@/types/database";

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "ADMIN") {
    return { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let body: {
    username?: string;
    password?: string;
    full_name?: string;
    role?: UserRole;
    email?: string;
    avatar_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = body.username?.trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = body.full_name?.trim() || null;
  const role = body.role;
  const email = body.email?.trim() || null;
  const avatarUrl = body.avatar_url?.trim() || null;

  if (!username) {
    return NextResponse.json({ error: "Username is required." }, { status: 400 });
  }
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: USERNAME_FORMAT_HINT }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }
  if (!role || !ALL_ROLES.includes(role)) {
    return NextResponse.json({ error: "A valid role is required." }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient();

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    const message =
      createError?.message?.includes("already registered") ||
      createError?.message?.includes("already been registered")
        ? "That username is already taken."
        : createError?.message ?? "Failed to create user.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("user_profiles")
    .insert({
      id: created.user.id,
      username,
      full_name: fullName,
      role,
      email,
      avatar_url: avatarUrl,
    })
    .select("*")
    .single();

  if (profileError) {
    // Roll back the auth user so we don't end up with an orphaned login.
    await serviceClient.auth.admin.deleteUser(created.user.id);
    const message = profileError.message.includes("duplicate")
      ? "That username is already taken."
      : profileError.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ user: profile }, { status: 201 });
}

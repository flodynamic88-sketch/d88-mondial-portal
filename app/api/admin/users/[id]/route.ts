import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/authUsername";
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

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let body: { role?: UserRole; full_name?: string; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient();

  if (body.password !== undefined) {
    if (body.password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }
    const { error: pwError } = await serviceClient.auth.admin.updateUserById(params.id, {
      password: body.password,
    });
    if (pwError) {
      return NextResponse.json({ error: pwError.message }, { status: 400 });
    }
  }

  let newUsername: string | undefined;
  if (body.username !== undefined) {
    newUsername = body.username.trim().toLowerCase();
    if (!newUsername) {
      return NextResponse.json({ error: "Username cannot be empty." }, { status: 400 });
    }
    // Username drives the internal login email, so keep Supabase Auth in
    // sync -- otherwise the account would still log in with the old name.
    const { error: emailError } = await serviceClient.auth.admin.updateUserById(params.id, {
      email: usernameToEmail(newUsername),
    });
    if (emailError) {
      const message = emailError.message.includes("already been registered")
        ? "That username is already taken."
        : emailError.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const updates: { role?: UserRole; full_name?: string | null; username?: string } = {};
  if (body.role !== undefined) {
    if (!ALL_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    updates.role = body.role;
  }
  if (body.full_name !== undefined) {
    updates.full_name = body.full_name.trim() || null;
  }
  if (newUsername !== undefined) {
    updates.username = newUsername;
  }

  if (Object.keys(updates).length > 0) {
    const { data, error } = await serviceClient
      .from("user_profiles")
      .update(updates)
      .eq("id", params.id)
      .select("*")
      .single();

    if (error) {
      const message = error.message.includes("duplicate")
        ? "That username is already taken."
        : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ user: data });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  if (user!.id === params.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient.auth.admin.deleteUser(params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

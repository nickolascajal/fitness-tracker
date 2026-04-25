"use server";

import { createClient } from "@supabase/supabase-js";
import { getAdminOverview, getUserWorkoutsForAdmin, type AdminOverview, type AdminUserWorkoutRow } from "./queries";

export type AdminOverviewActionResult =
  | { ok: true; data: AdminOverview }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data";
      message: string;
    };

export type AdminUserWorkoutsActionResult =
  | { ok: true; data: AdminUserWorkoutRow[] }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function assertAdminSessionOnServer(accessToken: string): Promise<
  { ok: true } | { ok: false; code: "no_token" | "invalid_token" | "not_admin" | "config"; message: string }
> {
  if (!accessToken.trim()) {
    return { ok: false, code: "no_token", message: "Missing access token." };
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!adminEmail) {
    return { ok: false, code: "config", message: "ADMIN_EMAIL is not configured." };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      code: "config",
      message: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured."
    };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return {
      ok: false,
      code: "config",
      message: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server."
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(accessToken);

  if (error || !user?.email) {
    return {
      ok: false,
      code: "invalid_token",
      message: "Server could not validate the provided access token."
    };
  }

  if (user.email.trim().toLowerCase() !== adminEmail) {
    return { ok: false, code: "not_admin", message: "Not authorized for admin data." };
  }

  return { ok: true };
}

/** Loads overview after server-side session + admin email check (service role queries stay server-only). */
export async function fetchAdminOverviewAction(accessToken: string): Promise<AdminOverviewActionResult> {
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await getAdminOverview();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      code: "data",
      message: "Admin data could not be loaded. Check server logs and SUPABASE_SERVICE_ROLE_KEY."
    };
  }
}

/** Loads one user’s workouts for admin detail (same server gate as overview). */
export async function fetchAdminUserWorkoutsAction(
  userId: string,
  accessToken: string
): Promise<AdminUserWorkoutsActionResult> {
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }

  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await getUserWorkoutsForAdmin(userId);
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      code: "data",
      message: "Could not load workouts. Check server configuration."
    };
  }
}

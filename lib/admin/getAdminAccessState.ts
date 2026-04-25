import { cache } from "react";
import { createServerSupabase } from "./supabaseServer";

export type AdminAccessOk = { ok: true; user: { id: string; email: string } };

export type AdminAccessBlocked = {
  ok: false;
  reason: "NO_ADMIN_EMAIL" | "NO_SERVICE_ROLE_KEY" | "NO_SESSION" | "NOT_ADMIN";
  message: string;
  detail?: string;
};

export type AdminAccessState = AdminAccessOk | AdminAccessBlocked;

/**
 * Server-only admin gate without redirects. Used by `/admin` layout for preview/debug.
 * Deduplicated per request when layout + page both call it.
 */
export const getAdminAccessState = cache(async (): Promise<AdminAccessState> => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    return {
      ok: false,
      reason: "NO_ADMIN_EMAIL",
      message:
        "ADMIN_EMAIL is not set on the server. Add it to your environment (e.g. Vercel project settings) to enable the admin dashboard."
    };
  }

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRole) {
    return {
      ok: false,
      reason: "NO_SERVICE_ROLE_KEY",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is not set on the server. Admin queries need the service role key (never expose it to the browser)."
    };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user?.email) {
    return {
      ok: false,
      reason: "NO_SESSION",
      message:
        "No Supabase auth session was found for this request. Sign in from the app, then open /admin again.",
      detail: error?.message
    };
  }

  const email = user.email.trim().toLowerCase();
  if (email !== adminEmail) {
    return {
      ok: false,
      reason: "NOT_ADMIN",
      message:
        "The signed-in account is not the configured admin. Dashboard access is limited to ADMIN_EMAIL.",
      detail: `Session email: ${user.email}\nConfigured ADMIN_EMAIL: ${adminEmail}`
    };
  }

  return { ok: true, user: { id: user.id, email: user.email } };
});

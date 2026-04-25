import { cache } from "react";

export type AdminEnvOk = { ok: true };

export type AdminEnvBlocked = {
  ok: false;
  reason: "NO_ADMIN_EMAIL" | "NO_SERVICE_ROLE_KEY";
  message: string;
};

export type AdminEnvState = AdminEnvOk | AdminEnvBlocked;

/**
 * Server-only checks for required admin env vars. Session and admin identity
 * are handled in the browser (`app/admin/*-client.tsx`) plus server actions.
 */
export const getAdminEnvState = cache(async (): Promise<AdminEnvState> => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    return {
      ok: false,
      reason: "NO_ADMIN_EMAIL",
      message:
        "ADMIN_EMAIL is not set on the server. Add it to your environment (e.g. Vercel project settings) to enable the admin dashboard."
    };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return {
      ok: false,
      reason: "NO_SERVICE_ROLE_KEY",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is not set on the server. Admin queries need the service role key (never expose it to the browser)."
    };
  }

  return { ok: true };
});

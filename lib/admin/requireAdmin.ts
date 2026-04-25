import { redirect } from "next/navigation";
import { createServerSupabase } from "./supabaseServer";

/**
 * Strict admin gate with redirects (e.g. for future middleware or hardened deploys).
 * Current `/admin` UI uses {@link getAdminAccessState} in the admin layout instead.
 *
 * - No session → `/`
 * - Session but not admin → `/workout`
 * - ADMIN_EMAIL unset → `/` (admin area disabled)
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    redirect("/");
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user?.email) {
    redirect("/");
  }

  const email = user.email.trim().toLowerCase();
  if (email !== adminEmail) {
    redirect("/workout");
  }

  return { id: user.id, email: user.email };
}

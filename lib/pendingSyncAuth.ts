import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

/**
 * Use for pending-sync flush: prefer getSession (reads persisted session) so
 * we don't skip flush on cold start when getUser() is still resolving over the network.
 */
export async function getUserForPendingSync(): Promise<{
  user: User | null;
  source: "session" | "getUser" | "error";
}> {
  try {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (session?.user) {
      return { user: session.user, source: "session" };
    }

    const {
      data: { user },
      error
    } = await supabase.auth.getUser();
    if (user && !error) {
      return { user, source: "getUser" };
    }

    return { user: null, source: "getUser" };
  } catch (e) {
    console.error("getUserForPendingSync failed:", e);
    return { user: null, source: "error" };
  }
}

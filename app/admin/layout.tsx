import type { ReactNode } from "react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Temporary: admin routes disabled until SSR auth/middleware is reworked. Dashboard code remains under `app/admin/`. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  void children;
  redirect("/");
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/auth", label: "Auth" },
  { href: "/library", label: "Your Library" },
  { href: "/workout", label: "Log a Workout" }
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) => pathname === href;

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign out error:", error);
      return;
    }
    router.push("/auth");
  };

  return (
    <nav className="flex gap-4 text-sm">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`origin-center transform-gpu transition-all duration-200 ease-out ${
              active
                ? "font-bold text-white md:text-slate-950"
                : "font-normal text-white/80 hover:scale-105 hover:font-semibold hover:text-white md:text-slate-700 md:hover:text-slate-950"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={handleSignOut}
        className="font-normal text-white/80 transition-colors hover:text-white md:text-slate-700 md:hover:text-slate-950"
      >
        Log out
      </button>
    </nav>
  );
}

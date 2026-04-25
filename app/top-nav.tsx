"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NavItem = {
  href: string;
  label: string;
};

const PUBLIC_NAV_ITEMS: NavItem[] = [
  { href: "/login", label: "Log In" },
  { href: "/signup", label: "Sign Up" }
];

const PRIVATE_NAV_ITEMS: NavItem[] = [
  { href: "/workout", label: "Log a Workout" },
  { href: "/library", label: "Your Library" },
  { href: "/profile", label: "Profile" }
];

export function TopNav() {
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const isActive = (href: string) => pathname === href;

  useEffect(() => {
    const resolveAdminAccess = async (accessToken: string) => {
      try {
        const response = await fetch("/api/admin/nav-access", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          cache: "no-store"
        });
        if (!response.ok) {
          setIsAdmin(false);
          return;
        }
        const data = (await response.json()) as { isAdmin?: boolean };
        setIsAdmin(Boolean(data.isAdmin));
      } catch {
        setIsAdmin(false);
      }
    };

    const loadSession = async () => {
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();
      if (error) {
        console.error("Session check error:", error);
        setIsLoggedIn(false);
        setIsAdmin(false);
        return;
      }

      if (!session?.access_token) {
        setIsLoggedIn(false);
        setIsAdmin(false);
        return;
      }

      setIsLoggedIn(true);
      await resolveAdminAccess(session.access_token);
    };

    void loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.access_token) {
        setIsLoggedIn(false);
        setIsAdmin(false);
        return;
      }
      setIsLoggedIn(true);
      void resolveAdminAccess(session.access_token);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const visibleItems = isLoggedIn
    ? isAdmin
      ? [...PRIVATE_NAV_ITEMS, { href: "/admin", label: "Admin Panel" }]
      : PRIVATE_NAV_ITEMS
    : PUBLIC_NAV_ITEMS;

  return (
    <nav className="flex gap-4 text-sm">
      {visibleItems.map((item) => {
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
    </nav>
  );
}

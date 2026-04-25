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
  { href: "/library", label: "Your Library" },
  { href: "/workout", label: "Log a Workout" },
  { href: "/profile", label: "Profile" }
];

export function TopNav() {
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const isActive = (href: string) => pathname === href;

  useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Session check error:", error);
        setIsLoggedIn(false);
        return;
      }

      setIsLoggedIn(Boolean(session));
    };

    void loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(Boolean(session));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const visibleItems = isLoggedIn ? PRIVATE_NAV_ITEMS : PUBLIC_NAV_ITEMS;

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

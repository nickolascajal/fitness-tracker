"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/library", label: "Your Library" },
  { href: "/workout", label: "Log a Workout" }
];

export function TopNav() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href;

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
    </nav>
  );
}

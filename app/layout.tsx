import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "@/app/providers";
import { TopNav } from "@/app/top-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "CS Fitness Tracker",
  description: "Simple workout tracker"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-8 pt-0 md:px-4 md:py-8">
            <header
              className={[
                "-mx-4 flex items-center justify-between bg-black",
                "px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-white",
                "md:mx-0 md:bg-transparent md:px-0 md:py-0 md:text-slate-900"
              ].join(" ")}
            >
              <Link
                href="/"
                className="text-xl font-semibold text-white transition-colors md:text-slate-900"
              >
                CS Fitness Tracker
              </Link>
              <TopNav />
            </header>
            <div
              className={[
                "-mx-4 mb-8 h-10 bg-gradient-to-b from-black/80 via-black/28 to-transparent",
                "md:hidden"
              ].join(" ")}
            />
            <main>{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

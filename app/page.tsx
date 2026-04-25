"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Home session check error:", error);
        setIsLoggedIn(false);
        setAuthChecked(true);
        return;
      }

      setIsLoggedIn(Boolean(session));
      setAuthChecked(true);
    };

    void loadSession();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(Boolean(session));
      setAuthChecked(true);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <section className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center space-y-5 pt-1 text-center sm:space-y-6 md:min-h-0 md:max-w-none md:items-start md:justify-start md:space-y-6 md:pt-6 md:text-left">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        Track Your Training
      </h1>
      <p className="mx-auto max-w-xl text-slate-600 md:mx-0">
        Track your workouts, manage your exercises, and see your progress over time.
      </p>

      {authChecked ? (
        <div className="mx-auto mt-1 flex w-full max-w-sm flex-col gap-3 min-[400px]:max-w-md min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:justify-center md:mx-0 md:mt-0 md:max-w-none md:justify-start">
          {isLoggedIn ? (
            <Link
              href="/library"
              className="w-full min-[400px]:w-auto min-[400px]:min-w-[8.5rem] rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-slate-800 md:py-2"
            >
              Go to App
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="w-full min-[400px]:w-auto min-[400px]:min-w-[8.5rem] rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-slate-800 md:py-2"
              >
                Log In
              </Link>
              <Link
                href="/signup"
                className="w-full min-[400px]:w-auto min-[400px]:min-w-[8.5rem] rounded-md border border-slate-200 bg-white/90 px-4 py-2.5 text-center text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 md:py-2"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

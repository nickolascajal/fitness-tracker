"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();
      if (error) {
        console.error("Login session check error:", error);
        return;
      }
      if (session) {
        router.replace("/library");
      }
    };
    void checkSession();
  }, [router]);

  const handleLogIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !password) {
      setMessage("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error("Log in error:", error);
      if (error.message.includes("Invalid login credentials")) {
        setMessage("Incorrect email or password.");
      } else {
        setMessage("Something went wrong. Please try again.");
      }
      setLoading(false);
      return;
    }

    router.push("/library");
  };

  return (
    <section className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Log In</h1>
      <form onSubmit={handleLogIn} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          disabled={loading}
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          disabled={loading}
        />
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Working..." : "Log In"}
        </button>
      </form>
      <p className="text-sm text-slate-600">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-slate-900 underline underline-offset-2">
          Sign up
        </Link>
      </p>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}

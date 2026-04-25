"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
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
        console.error("Signup session check error:", error);
        return;
      }
      if (session) {
        router.replace("/workout");
      }
    };
    void checkSession();
  }, [router]);

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !password) {
      setMessage("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      console.error("Sign up error:", error);
      if (error.message.includes("User already registered")) {
        setMessage("This email is already registered. Try logging in instead.");
      } else {
        setMessage("Something went wrong. Please try again.");
      }
      setLoading(false);
      return;
    }

    if (data.session) {
      router.push("/workout");
      return;
    }

    setMessage("Sign up successful. Check your email to confirm your account.");
    setLoading(false);
  };

  return (
    <section className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Sign Up</h1>
      <form onSubmit={handleSignUp} className="space-y-3">
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
          autoComplete="new-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          disabled={loading}
        />
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Working..." : "Sign Up"}
        </button>
      </form>
      <p className="text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-900 underline underline-offset-2">
          Log in
        </Link>
      </p>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}

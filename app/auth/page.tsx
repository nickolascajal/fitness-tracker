"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthPage() {
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
        console.error("Error checking session:", error);
        return;
      }

      if (session) {
        router.replace("/");
      }
    };

    void checkSession();
  }, [router]);

  const validateFields = () => {
    if (!email || !password) {
      setMessage("Please enter both email and password.");
      return false;
    }
    return true;
  };

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateFields()) return;

    setLoading(true);
    setMessage("");

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      console.error("Sign up error:", error);
      setMessage("Unable to sign up. Please try again.");
      setLoading(false);
      return;
    }

    if (data.session) {
      router.push("/");
      return;
    }

    setMessage("Sign up successful. Check your email to confirm your account.");
    setLoading(false);
  };

  const handleLogIn = async () => {
    if (!validateFields()) return;

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error("Log in error:", error);
      setMessage("Unable to log in. Please check your credentials.");
      setLoading(false);
      return;
    }

    router.push("/");
  };

  return (
    <section className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Account Access</h1>
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
          autoComplete="current-password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
          disabled={loading}
        />
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Working..." : "Sign Up"}
          </button>
          <button
            type="button"
            onClick={handleLogIn}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Working..." : "Log In"}
          </button>
        </div>
      </form>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}

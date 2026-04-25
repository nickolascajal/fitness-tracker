import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

function unauthorized() {
  return NextResponse.json({ isAdmin: false }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!adminEmail || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ isAdmin: false }, { status: 200 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorized();
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    return unauthorized();
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(accessToken);

  if (error || !user?.email) {
    return unauthorized();
  }

  const isAdmin = user.email.trim().toLowerCase() === adminEmail;
  return NextResponse.json({ isAdmin }, { status: 200 });
}

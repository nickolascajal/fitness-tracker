import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes Supabase auth cookies on matched requests so Server Components
 * (including `/admin`) see a valid session in production.
 *
 * Beta routing: unauthenticated users on internal app routes → `/`, except
 * `/admin` (handled by `requireAdmin()`).
 *
 * Matcher is an allowlist of app paths only so we never touch `/_next/*`,
 * static files, or other internals (fixes broken client navigation).
 */
export async function middleware(request: NextRequest) {
  const supabaseResponse = NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          supabaseResponse.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isPublicRoute =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/");

  const isBetaProtectedInternal =
    !isPublicRoute &&
    !isAdminRoute &&
    (pathname === "/workout" ||
      pathname === "/library" ||
      pathname === "/profile" ||
      pathname === "/exercise" ||
      pathname.startsWith("/workout/") ||
      pathname.startsWith("/library/") ||
      pathname.startsWith("/profile/"));

  if (isBetaProtectedInternal && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/signup",
    "/auth",
    "/auth/:path*",
    "/workout/:path*",
    "/library/:path*",
    "/profile/:path*",
    "/exercise/:path*",
    "/admin/:path*"
  ]
};

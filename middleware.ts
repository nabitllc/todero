import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/progress/session";

/*
  Gate /progress behind the signed session cookie. The login page itself is
  open. A missing secret means the gate is closed, not open.
*/
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/progress/login") return NextResponse.next();
  const secret = process.env.PROGRESS_SECRET;
  const ok = secret ? await verifySession(secret, request.cookies.get(SESSION_COOKIE)?.value) : false;
  if (ok) return NextResponse.next();
  const login = request.nextUrl.clone();
  login.pathname = "/progress/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/progress", "/progress/:path*"],
};

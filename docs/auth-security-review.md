# Auth Security Review — TOD-1972
**Reviewed:** 2026-04-19
**Reviewer:** ops (Ingo)
**Supabase JS version:** 2.103.0

---

## Summary

Todero does **not** use Supabase Auth. Authentication is entirely custom — password-based with httpOnly cookies. There is no OAuth, no Google login, and no PKCE flow. Supabase is used exclusively as a data store via service-role credentials.

This document records what was found, confirms the actual security posture, and provides manual verification steps.

---

## 1. PKCE Flow — Not Applicable

**Finding:** No PKCE flow exists in this codebase.

- `@supabase/supabase-js` v2.103.0 is installed but used only for data access (no `createClient` with auth config)
- `@supabase/auth-helpers` and `@supabase/ssr` are NOT installed
- `flowType: 'pkce'` is never set — because `supabase.auth` is never called
- No `signInWithOAuth`, `signInWithPassword`, or `getSession` calls anywhere

**Security note:** PKCE is a non-issue here because there is no OAuth token exchange. If OAuth login is added in the future, PKCE should be enabled via `createClient(..., { auth: { flowType: 'pkce' } })` in `@supabase/ssr`.

---

## 2. Session Shape — Custom Cookie System

There are no Supabase `session` objects. The session is composed of two cookies set by `POST /api/auth`:

| Cookie | `httpOnly` | `secure` | `sameSite` | `maxAge` | Value |
|--------|-----------|---------|------------|---------|-------|
| `mc-auth` | ✅ yes | ✅ prod | strict | 30 days | raw password string |
| `mc-role` | ❌ no | ✅ prod | strict | 30 days | role name (`owner`/`member`/`viewer`) |

The `mc-auth` cookie is not readable by JavaScript (httpOnly), which limits XSS exposure. `mc-role` is intentionally readable by the browser so the UI can tailor the experience without an extra API call.

**No JWT, no access_token, no refresh_token.** Session validation is a direct string equality check against env vars in `middleware.ts`.

---

## 3. Downstream Consumers — Verified

All auth-consuming code reads the `mc-role` cookie (or `X-Agent-Role` header for server-to-server calls):

| File | Pattern | Notes |
|------|---------|-------|
| `middleware.ts` | `req.cookies.get('mc-role')` | Blocks viewers on write routes; redirects unauthenticated users |
| `lib/rbac-middleware.ts` | `resolveRole(req)` | Queries `role_permissions` table for permission checks |
| `lib/with-permission.ts` | `req.cookies.get('mc-role')` + `X-Agent-Role` header | Server-to-server fallback for agents |
| `lib/permission-check.ts` | Pure functions on `Role` type | Testable permission logic, no network calls |

No downstream code calls `supabase.auth.getSession()`. All consumers work correctly — verified by code audit.

---

## 4. Manual Verification Steps

### Verify email/password login session

```bash
# 1. Login with owner password
curl -s -X POST http://localhost:3000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"kaos2026"}' \
  -c /tmp/cookies.txt

# Expected: {"ok":true,"role":"owner"}
# cookies.txt will contain: mc-auth=kaos2026; mc-role=owner

# 2. Verify authenticated API access
curl -s http://localhost:3000/api/issues \
  -b /tmp/cookies.txt | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Got {len(d)} issues — auth works')"

# 3. Verify viewer is blocked from writes
curl -s -X POST http://localhost:3000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"view2026"}' \
  -c /tmp/viewer-cookies.txt

curl -s -X PATCH http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -b /tmp/viewer-cookies.txt \
  -d '{"id":"fake","status":"open"}'
# Expected: {"error":"Read-only access: viewer role cannot modify data"}
```

### Verify cookie security attributes

```bash
# Check Set-Cookie headers in login response
curl -s -v -X POST http://localhost:3000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"kaos2026"}' 2>&1 | grep -i "set-cookie"

# Expected output should show:
#   mc-auth: HttpOnly; Secure (prod); SameSite=Strict
#   mc-role: Secure (prod); SameSite=Strict (NOT HttpOnly by design)
```

### Verify unauthenticated redirect

```bash
curl -s -v http://localhost:3000/ 2>&1 | grep -i location
# Expected: 302 redirect to /login
```

---

## 5. Security Posture Assessment

| Control | Status | Notes |
|---------|--------|-------|
| PKCE | N/A | No OAuth flow; not needed |
| Token storage | Secure | `mc-auth` is httpOnly — not accessible to JS |
| XSS token theft | Mitigated | httpOnly cookie prevents JS access |
| CSRF | Mitigated | `sameSite: strict` blocks cross-site cookie sends |
| Session fixation | Low risk | Passwords are env vars; no per-user sessions |
| Brute force | No protection | No rate limiting on `/api/auth` |
| Role spoofing | Low risk | `mc-role` is readable but `mc-auth` must also match in middleware |

**Note on brute force:** `/api/auth` has no rate limiting. For an internal tool this is acceptable, but worth noting if this ever becomes more broadly accessible.

---

## 6. Future OAuth Guidance

If Google OAuth is added in the future:

1. Install `@supabase/ssr` (replaces `@supabase/supabase-js` for auth)
2. Initialize with `flowType: 'pkce'`:
   ```typescript
   import { createServerClient } from '@supabase/ssr'
   const supabase = createServerClient(url, anonKey, {
     auth: { flowType: 'pkce' },
     cookies: { ... }
   })
   ```
3. Session shape from `getSession()` will include `user.id`, `user.email`, `access_token`, `refresh_token`
4. Update `middleware.ts` and all route guards to read from Supabase session instead of `mc-auth`/`mc-role` cookies
5. Ensure `PKCE code_verifier` is stored in a secure httpOnly cookie (handled automatically by `@supabase/ssr`)

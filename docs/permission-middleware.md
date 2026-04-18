# Permission Middleware — `withPermission()`

TOD-1496 | `lib/with-permission.ts`

## Overview

`withPermission()` is a Next.js App Router route wrapper that enforces RBAC before your handler runs. It resolves the caller's role, checks the `role_permissions` table (via `ROLE_PERMISSIONS` in `lib/rbac-types.ts`), and returns a machine-readable 403 if access is denied.

## How to Apply to a Route

```ts
// app/api/your-route/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withPermission } from '@/lib/with-permission'

// Protect GET with memory:read
export const GET = withPermission('memory:read', async (req: NextRequest) => {
  // Your handler — only called when the caller has the permission
  return NextResponse.json({ ok: true })
})

// Protect POST with issues:write
export const POST = withPermission('issues:write', async (req: NextRequest) => {
  const body = await req.json()
  // ...
  return NextResponse.json({ created: true })
})
```

## Role Resolution

Resolution order (first match wins):

| Priority | Source | Condition |
|---|---|---|
| 1 | `mc-auth` + `mc-role` cookies | Valid session exists |
| 2 | `X-Agent-Role` header | No valid session (agent callers only) |
| 3 | `null` → 403 | Neither present |

**Spoof protection:** `X-Agent-Role` is ignored when a valid `mc-auth` cookie is present. A logged-in human cannot escalate to an agent role by adding the header.

## 403 Response Body

```json
{
  "error": "forbidden",
  "code": "PERMISSION_DENIED",
  "role": "viewer",
  "required": "issues:write",
  "message": "missing permission: issues:write is not granted to role \"viewer\""
}
```

When no role is resolved (unauthenticated):

```json
{
  "error": "forbidden",
  "code": "PERMISSION_DENIED",
  "role": "unauthenticated",
  "required": "issues:write",
  "message": "invalid role: no valid session or recognized agent role"
}
```

## Available Permissions

See `lib/rbac-types.ts` → `Permission` type for the full list. Common ones:

| Permission | Who has it |
|---|---|
| `issues:read` | god, admin, viewer, tron, defaultbot |
| `issues:write` | god, admin, tron, defaultbot |
| `issues:delete` | god, admin |
| `agents:spawn` | god, admin, tron |
| `memory:read` | god, admin, viewer, tron |
| `memory:write` | god, admin, tron |
| `settings:write` | god, admin |
| `infra:admin` | god only |

## Example Route Using the Wrapper

`app/api/memory/route.ts` is the canonical example — see how `GET` is exported as `withPermission('memory:read', ...)`.

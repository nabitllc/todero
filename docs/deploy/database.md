---
title: Database
summary: Embedded PGlite vs Docker Postgres vs hosted
---

Todero uses PostgreSQL via Drizzle ORM. There are three ways to run the database.

## 1. Embedded PostgreSQL (Default)

Zero config. If you don't set `DATABASE_URL`, the server starts an embedded PostgreSQL instance automatically.

```sh
pnpm dev
```

On first start, the server:

1. Creates `~/.todero/instances/default/db/` for storage
2. Ensures the `todero` database exists
3. Runs migrations automatically
4. Starts serving requests

Data persists across restarts. To reset: `rm -rf ~/.todero/instances/default/db`.

The Docker quickstart also uses embedded PostgreSQL by default.

## 2. Local PostgreSQL (Docker)

For a full PostgreSQL server locally:

```sh
docker compose up -d
```

This starts PostgreSQL 17 on `localhost:5432`. Set the connection string:

```sh
cp .env.example .env
# DATABASE_URL=postgres://todero:todero@localhost:5432/todero
```

Push the schema:

```sh
DATABASE_URL=postgres://todero:todero@localhost:5432/todero \
  npx drizzle-kit push
```

## 3. Hosted PostgreSQL (Neon)

For production, use a hosted provider like [Neon](https://neon.tech/).

1. Create a project in the Neon console
2. Copy the connection string from Connection Details
3. Set `DATABASE_URL` in your `.env`

Use the **direct connection** for migrations and the **pooled connection** (the host with a `-pooler` suffix) for the application.

If using connection pooling (transaction mode), disable prepared statements via the environment — no source edits needed:

```sh
DATABASE_PREPARED_STATEMENTS=false
```

Related optional client tuning (driver defaults apply when unset): `DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_SECONDS`, `DATABASE_CONNECT_TIMEOUT_SECONDS`.

## Switching Between Modes

| `DATABASE_URL` | Mode |
|----------------|------|
| Not set | Embedded PostgreSQL |
| `postgres://...localhost...` | Local Docker PostgreSQL |
| `postgres://...neon.tech...` | Hosted PostgreSQL (Neon or any provider) |

The Drizzle schema (`packages/db/src/schema/`) is the same regardless of mode.

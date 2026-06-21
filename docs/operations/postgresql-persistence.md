# PostgreSQL Persistence Harness

Date: 2026-06-21

Epic 7 uses PostgreSQL with plain SQL migrations and `node-postgres`.

## Local PostgreSQL

Start the local database:

```bash
docker compose up -d postgres
```

Local connection values:

| Setting | Value |
| --- | --- |
| Host port | `55432` |
| Container port | `5432` |
| Database | `china_slot_test` |
| User | `china_slot` |
| Password | `china_slot_password` |
| `DATABASE_URL` | `postgres://china_slot:china_slot_password@localhost:55432/china_slot_test` |
| `TEST_DATABASE_URL` | `postgres://china_slot:china_slot_password@localhost:55432/china_slot_test` |

CI uses the same disposable database name and credentials, but connects to the GitHub Actions service container on `localhost:5432`.

## Commands

Run migrations:

```bash
DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run db:migrate -w @china-slot-game/api
```

Check schema readiness:

```bash
DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run db:check -w @china-slot-game/api
```

Roll back all migrations in a disposable database:

```bash
DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run db:rollback -w @china-slot-game/api
```

Run PostgreSQL-backed integration tests:

```bash
TEST_DATABASE_URL=postgres://china_slot:china_slot_password@localhost:55432/china_slot_test npm run test:integration -w @china-slot-game/api
```

The integration tests reset the `public` schema and require the database name to include `test`.

## Runtime Environment

Production or PostgreSQL persistence mode requires a valid PostgreSQL URL:

```bash
PERSISTENCE_MODE=postgres
DATABASE_URL=postgres://user:password@host:5432/database
```

`NODE_ENV=production` also requires `DATABASE_URL`. Local and test modes remain in-memory unless dependencies are injected explicitly or `PERSISTENCE_MODE=postgres` is set.
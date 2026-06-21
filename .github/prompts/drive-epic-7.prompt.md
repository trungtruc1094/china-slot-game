---
mode: agent
description: Drive epic-7 (PostgreSQL persistence migration) end-to-end
---

Drive `_bmad-output/implementation-artifacts` to completion for epic-7 only.

Epic-7 swaps the storage layer of every feature from epics 2 through 6 to
PostgreSQL. Behavior must not change; only persistence does. Test suites
from prior epics must still pass after each story.

The sprint state file is `sprint-status.yaml`.
Story files live in `_bmad-output/implementation-artifacts/`.
Ignore entries whose key starts with `epic-` or ends with `-retrospective`.
Process stories strictly in the order they appear in `development_status`.
Only touch stories belonging to epic-7 (7-1 through 7-9). Stop before any
epic that comes after.

## Pre-flight (do this before starting 7-1)

- Read every prior retrospective in `_bmad-output/implementation-artifacts/`
  (epic-1 through epic-6). Surface any persistence-related findings in a
  one-paragraph note before starting 7-1.
- Verify the current test suite passes against the existing in-memory
  storage. `npm test && npm run build` must be green BEFORE any
  migration work begins.

## Per-story loop

For each remaining story (status = `backlog`):

1. Run `bmad-create-story`. Status should move to `ready-for-dev`.
2. Run `bmad-dev-story`. Implement fully; status moves to `review`.
3. Run `bmad-code-review` with the criteria below. Require concrete
   evidence — do not pass on "looks fine".
4. Run `npm test && npm run build`. ALSO run any PG-backed integration
   test the story introduces. If either fails, stop and report.
5. On review pass, set status to `done` in `sprint-status.yaml` AND
   update the story file's front-matter `Status` to `done`. Both must
   match.
6. `git add -A && git commit -m "feat(<story-id>): <short story title>"`

If a story is already at `ready-for-dev` or `in-progress`, resume from
`bmad-dev-story` for that story.

## Code-review gate (must all be true to mark done)

- All acceptance criteria covered by tests, and tests run in `npm test`.
- Assumptions documented in story dev notes.
- Public API contracts unchanged from prior epics unless the story
  explicitly says otherwise (this epic is a swap, not a redesign).
- Lint and typecheck clean.
- Story artifact `Status` matches `sprint-status.yaml`.
- Existing tests from prior epics still pass after the swap.

## Story-specific review requirements

- **7-1 (PostgreSQL runtime and migration harness):** migrations are
  reversible (up and down); test covers `migrate up && migrate down &&
  migrate up` from a clean DB; migration tool is invokable from `npm`
  scripts; dev notes document local PG setup (Docker compose, env
  vars, ports); CI can spin up PG and run migrations.

- **7-2 (players, provider identity, sessions):** foreign keys enforced
  at DB level (cascade or restrict explicitly chosen and documented);
  session expiry is enforced via a column + query, not an in-memory
  timer; test asserts identity uniqueness across providers.

- **7-3 (configuration versions, math reports, simulation runs):** math
  report blobs are stored efficiently (state strategy — JSONB, large
  object, external file ref); version chain is queryable in one
  statement; test covers loading a real epic-1 math package output.

- **7-4 (wallets and wallet transactions with concurrency safety):**
  locking strategy is explicit in dev notes (SELECT FOR UPDATE vs
  optimistic vs advisory locks vs serializable isolation — pick one and
  justify); test runs >=10 concurrent debits against a real PG
  instance and asserts final balance is exact; test asserts a debit
  that would overdraw is rejected atomically with no partial state.

- **7-5 (accepted spins and durable spin idempotency atomically):**
  spin acceptance, wallet debit, and idempotency key insertion are in
  a single PG transaction; test asserts a transaction failure midway
  leaves all three tables consistent (no orphans); idempotency test
  runs duplicate requests against real PG and asserts same result +
  single debit; index on idempotency key is unique and documented.

- **7-6 (operational controls, metrics, alerts, audit, request traces):**
  high-volume tables (metrics, traces) have indexing and retention
  policy documented; partitioning strategy noted (even if "not yet" is
  the answer); existing audit search from epic-5 still returns the
  same results against the PG-backed store.

- **7-7 (future tevi top-up idempotency persistence):** idempotency
  contract is documented (key shape, retention window, response replay
  semantics); test covers a duplicate top-up request returning the
  original response without double-crediting; even though the full
  top-up flow is future work, the persistence layer here must not
  block that flow.

- **7-8 (production PostgreSQL dependencies and fail-safe startup):**
  behavior when PG is unreachable on boot is explicit (refuse to
  accept spins, return 503, log structured error); behavior when PG
  becomes unreachable mid-operation is explicit (circuit-breaker,
  retry strategy, or degrade); test simulates PG unreachable and
  asserts the documented behavior; production config sample is
  committed (env vars, pool sizes, timeouts).

- **7-9 (verify persistence recovery, admin search, quality gates):**
  explicit recovery test — stop PG mid-run, restart it, prove
  in-flight idempotency replays land correctly; admin search from
  epic-5 returns identical results to pre-migration baseline (use a
  seeded dataset); CI quality gates from epic-6 are extended to
  include the PG-backed test suite; final summary lists every
  pre-epic-7 test that still passes and any that were modified
  (with a reason).

## Failure handling

If any review requirement fails, do NOT mark the story done. Iterate
within the same story, re-run review and tests, and only proceed when
the gate passes. If you cannot make the gate pass after a reasonable
attempt, stop and report which requirement is blocking.

## Completion

When 7-1 through 7-9 are all `done`:

- Set epic-7 to `done` in `sprint-status.yaml`.
- Do NOT auto-run `bmad-retrospective`. Stop and report the epic is
  feature-complete so I can run the retrospective manually.

## Reporting

Report after each story:
- Story id
- New status
- Commit hash
- Key implementation decisions (especially locking strategy for 7-4 and
  transaction shape for 7-5)
- Which review requirements were verified

Stop immediately on any unrecoverable failure and leave
`sprint-status.yaml` consistent.
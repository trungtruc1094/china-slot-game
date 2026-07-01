
## Deferred from: code review of 8-5-run-sdk-top-up-with-pending-wallet-state (2026-06-29)

- AC7 manual sandbox Check Round documented but not executed — requires a human Tevi sandbox run (sandbox card 4242 4242 4242 4242). Records real SDK callback shape, pending UI, cancellation/failure, and missing-deposit_token 403 surfacing. Spec-permitted to use placeholder evidence; credited-state blocked by Story 8.6.
- Confirm `extractSafeTopupReference` `data.id` (js/teviClient.js) is a safe non-sensitive reference before it is shown in the pending-state UI message — verify during AC7 sandbox observation.

## Deferred from: code review of 8-6-verify-tevi-webhooks-and-credit-stars-idempotently (2026-06-30)

- Webhook credit path bootstraps a missing wallet at starterBalance=1000 (tevi-webhook-credit-repository.ts:15,61-66) — first-ever credit for a player with no wallet row yields `1000 + amount`, contradicting "production users start at 0." Matches the system-wide `PostgresWalletRepository` bootstrap; resolve in Epic-9 production-compliance work (wallets should bootstrap at 0 in production).
- No upper-bound sanity cap on credited webhook amount (tevi-webhook-service.ts:254-257) — only `Number.isSafeInteger`/`> 0` guards the credited amount; capping at the webhook risks under-crediting a real larger deposit, so defer to Epic-9 money-path hardening (Story 9.5).

## Deferred from: code review of 8-7-spin-with-server-owned-stars-wallet-and-ledger (2026-06-30)

- Local/demo balance label loses its leading space on first render (js/slotConfig3x5.js:1039 initial render vs js/slot_classes.js:1578 update handler `' ' + newCount`) — the balance text shifts one space the first time it updates after a spin. Pre-existing and purely cosmetic (initial render had no leading space before Story 8.7 either); Tevi mode is consistent. Tidy alongside any future client-UI pass.

## Deferred from: code review of 8-12-fix-tevi-mini-app-session-balance-load-race (2026-06-30)

- AC5 manual Tevi sandbox Check Round — **completed 2026-07-01** as part of Story 8.12 closure (balance load, spin, deposit credit without reload, dialog auto-close). Deferred items below remain open.
- Timing tests stub `scheduleSceneDelay` to fire its callback synchronously (apps/api/test/unit/server-client.test.ts), so the bounded-recursion caps (`maxAttempts` in `loadBackendSessionBalance` / `pollPostDepositBalance`) and real async ordering are never exercised against deferred scheduling. A missing/incorrect base case wouldn't be caught. Add a deferred-scheduler test that proves the cap halts an always-failing transient.
- Robust post-deposit confirmation: match the webhook deposit reference/status rather than a balance delta, to eliminate the residual false-negative when the credited balance doesn't strictly rise (e.g. concurrent spend). Belongs with Epic 10 `10-3` (deposit/cashout status UX); the minimal server-baseline guard applied in 8.12 only removes the false-positive.
- `refreshSession()` (js/serverClient.js:285-300) nulls `session`/`sessionRequest` unconditionally before `startSession()`; a concurrent in-flight `startSession()` (spin) could be discarded → duplicate Tevi token-exchange / session creation, and `backendSpinStatus` is last-writer-wins. Latent only today (deposit modal blocks concurrent spins; poll ticks are sequential). Add a serialization/in-flight guard if the deposit flow ever becomes non-modal.

## Deferred from: code review of 8-8-request-manual-tevi-stars-cashout (2026-07-01)

- AC10 manual Tevi sandbox cashout Check Round — requires human sandbox run with funded provider account to verify live `POST /api/v1/payments/cashout` dispatch.
- Epic 9 compliance/KYC/self-exclusion/host-float hard stops on cashout — stubbed pass-through in sandbox MVP; implement in Epic 9.
- Operator reconciliation/retry UI for `failed_retryable` cashouts — Story 8.9.


## Deferred from: code review of 8-5-run-sdk-top-up-with-pending-wallet-state (2026-06-29)

- AC7 manual sandbox Check Round documented but not executed — requires a human Tevi sandbox run (sandbox card 4242 4242 4242 4242). Records real SDK callback shape, pending UI, cancellation/failure, and missing-deposit_token 403 surfacing. Spec-permitted to use placeholder evidence; credited-state blocked by Story 8.6.
- Confirm `extractSafeTopupReference` `data.id` (js/teviClient.js) is a safe non-sensitive reference before it is shown in the pending-state UI message — verify during AC7 sandbox observation.

## Deferred from: code review of 8-6-verify-tevi-webhooks-and-credit-stars-idempotently (2026-06-30)

- Webhook credit path bootstraps a missing wallet at starterBalance=1000 (tevi-webhook-credit-repository.ts:15,61-66) — first-ever credit for a player with no wallet row yields `1000 + amount`, contradicting "production users start at 0." Matches the system-wide `PostgresWalletRepository` bootstrap; resolve in Epic-9 production-compliance work (wallets should bootstrap at 0 in production).
- No upper-bound sanity cap on credited webhook amount (tevi-webhook-service.ts:254-257) — only `Number.isSafeInteger`/`> 0` guards the credited amount; capping at the webhook risks under-crediting a real larger deposit, so defer to Epic-9 money-path hardening (Story 9.5).

## Deferred from: code review of 8-7-spin-with-server-owned-stars-wallet-and-ledger (2026-06-30)

- Local/demo balance label loses its leading space on first render (js/slotConfig3x5.js:1039 initial render vs js/slot_classes.js:1578 update handler `' ' + newCount`) — the balance text shifts one space the first time it updates after a spin. Pre-existing and purely cosmetic (initial render had no leading space before Story 8.7 either); Tevi mode is consistent. Tidy alongside any future client-UI pass.

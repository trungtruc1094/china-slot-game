
## Deferred from: code review of 8-5-run-sdk-top-up-with-pending-wallet-state (2026-06-29)

- AC7 manual sandbox Check Round documented but not executed — requires a human Tevi sandbox run (sandbox card 4242 4242 4242 4242). Records real SDK callback shape, pending UI, cancellation/failure, and missing-deposit_token 403 surfacing. Spec-permitted to use placeholder evidence; credited-state blocked by Story 8.6.
- Confirm `extractSafeTopupReference` `data.id` (js/teviClient.js) is a safe non-sensitive reference before it is shown in the pending-state UI message — verify during AC7 sandbox observation.

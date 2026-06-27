---
title: Tevi Mini App Integration PRD Addendum - China Slot Game
status: draft
created: 2026-06-27
updated: 2026-06-27
parent_prd: prd-china-slot-game-2026-06-01
---

# Tevi Mini App Integration PRD Addendum: China Slot Game

## 0. Understanding And Open Assumptions

### Understanding

This addendum plans the product change from an internal, non-cash reward prototype into a Tevi Mini App where Tevi Stars are the end-to-end wallet currency for production play. Players deposit Stars into an internal game wallet, bet in Stars from that wallet, wins are credited back to that wallet, and players manually cash out by entering an amount in the game UI. The game server remains fully authoritative for authentication mapping, wager validation, RNG, win calculation, wallet balance, ledger, cashout request validation, dispatch, reconciliation, and audit history.

The existing PRD, database persistence addendum, and architecture already establish server-authoritative gameplay, PostgreSQL-backed wallets and ledgers, spin idempotency, integer minor units, configuration validation, RTP simulation, operator limits, and a future-ready Tevi top-up idempotency table. This addendum intentionally advances the Tevi boundary: future-ready idempotency is no longer enough for this product path. The Tevi integration must implement Tevi auth, top-up, webhook crediting, Stars wallet accounting, manual cashout requests, Tevi Message receipts, float guardrails, and compliance gates.

The implementation must remain sandbox-first. Phase 1 proves end-to-end behavior in Tevi sandbox only. Phase 2 is the hard gate for production exposure and includes legal counsel review, permitted-jurisdiction geo-gating, age gate, KYC where available, responsible-gaming controls, deposit limits, self-exclusion, host float controls, security review, Tevi API key/secret approval, and production cutover. Phase 3 polishes notifications, UX, analytics, and tuning.

### Open Assumptions

- Tevi sandbox and production APIs follow the endpoints and payloads provided in this request; any later Tevi documentation conflict must trigger a PRD/architecture update before implementation.
- `provider_topup_idempotency` / `tevi_topup_idempotency` exists or will exist through the persistence work; this integration will extend it to perform idempotent wallet crediting rather than only storing future-ready records.
- The Tevi webhook signature algorithm is provided by Tevi as `verify_webhook_signature()` or an equivalent documented algorithm/library before implementation begins.
- Tevi user JWTs are RS256 tokens verifiable through `GET /api/v1/auth/jwks`, and JWKS responses can be cached with normal key-rotation handling.
- The existing API envelope remains `{data, error, requestId}` for all game-owned endpoints.
- The game keeps the existing static Phaser/H5 delivery model and adds a thin `js/teviClient.js` adapter alongside `js/serverClient.js`.
- Production hosting will provide public `app_url` and `webhook_url` values reachable by Tevi.
- The host can maintain a funded Stars float account large enough to cover projected payouts and jackpot exposure.
- Tevi Stars are treated as real-money-style value for product risk, compliance, audit, observability, and rollback planning, even though the game does not implement fiat withdrawal or currency conversion.
- Tunable defaults in this document are initial product defaults, not hard-coded economics; final live values require simulator verification and approval.

## 1. Purpose

This addendum defines product requirements for integrating China Slot Game as a Tevi Mini App using Tevi Stars as the real wallet currency. It supersedes the prior non-cash reward boundary only for the Tevi integration path. It does not remove the requirement that all reward-bearing gameplay be server-authoritative, durable, auditable, idempotent, and observable.

The addendum is written for downstream architecture, epics, stories, implementation-readiness checks, and verification playbooks. Architecture wiring, concrete repository/service boundaries, migrations, and endpoint implementation details belong in the architecture addendum and implementation stories.

## 2. Product Positioning

China Slot Game becomes a sandbox-first Tevi Mini App slot experience where a Tevi user can:

- Launch the game inside Tevi.
- Authenticate through Tevi identity.
- Top up Stars through Tevi SDK `topup()`.
- Receive an idempotent internal Stars wallet credit through Tevi `user_topup` webhook processing.
- Spin using server-authoritative game math and wallet debits.
- Manually cash out a selected amount from their internal Stars wallet through the game UI.
- Receive Tevi Message receipts for top-ups and wins.

The product must feel like the existing Phaser slot game, but every value-bearing decision and mutation must come from the server.

## 3. Ground Truth Tevi Context

### 3.1 Environments

- Sandbox portal: `developers.sbx.tevi.dev`
- Sandbox API: `developer-api.sbx.tevi.dev`
- Sandbox app host: `sbx.tevi.dev`
- Production portal: `developers.tevi.com`
- Production API: `developer-api.flowstreamx.com`

Sandbox payment test card:

- Card: `4242 4242 4242 4242`
- Expiry: `12/30`
- CVV: `123`

### 3.2 Platform Rules

- One active app per account.
- Five drafts maximum.
- Active channel required.
- API Key and Secret Key are issued only after Tevi review and approval.
- App registration must include public `app_url`, `webhook_url`, and required webhook scopes.

### 3.3 Auth And Identity

- Tevi JWTs are RS256 and verified through JWKS: `GET /api/v1/auth/jwks`.
- Grant flow gives the Mini App a Tevi token.
- Token exchange endpoint: `GET /api/v1/auth/token?app_id=...` with `Authorization: Bearer <TEVI_TOKEN>` returns `{access_token, refresh_token}`.
- Access token TTL: 24 hours.
- Refresh token TTL: 24 weeks.
- JWT claims include `user_id`, `user_name`, `user_email`, `user_is_active`, `user_anonymous`, `user_avatar`, and `app_id`.
- User endpoints include `GET /api/v1/auth/user` and `GET /api/v1/auth/user/balance`.
- Auth mechanisms include User JWT via `Authorization: Bearer` and API Key via `X-API-Key` with scoped permissions such as `app.read` and `payment.write`.
- Tevi `user_id` maps to internal `player_id` through provider identity mappings.

### 3.4 Frontend SDK

The static client must load:

```html
<script src="https://static.tevicdn.com/helper_tevi.js"></script>
```

The adapter must use `window.TeviJS` methods where available:

- `getUserInfo({is_popup, app_id}, cb)` returns `data.userInfo.user_app_token` for the runtime session.
- `topup({amount, deposit_token, channel_id, metadata}, cb)` returns success when `res.call === 'ok'`.
- `executeLink`, `createPost`, `downloadMedia`, `showBackButton`, `showCloseButton`, `quitGame`, and `loadConfig({optionMenu, layoutMode, config, version})` are available for Mini App integration and polish.

### 3.5 Top-Up Flow

- Mini App requests a backend-issued deposit token through `POST /api/v1/payments/top-up-signature` with `{amount}`.
- Backend returns `{deposit_token}`.
- Client calls SDK `topup({amount, deposit_token, channel_id})`.
- Tevi displays a confirmation popup.
- On confirmation, Tevi executes the top-up and fires a `user_topup` webhook.
- The Mini App is notified after webhook handling.
- Missing `deposit_token` returns `403` from Tevi.
- `channel_id` / `billing_channel_id` are inside the deposit token JWT.
- The deposit token must be issued by the backend, not directly by untrusted client logic.

Webhook payload shape:

```json
{
  "id": "evt_...",
  "event": "user_topup",
  "space_id": "...",
  "created_at": "2026-06-27T00:00:00Z",
  "data": {
    "user": "tevi_user_id",
    "amount": 20,
    "metadata": {
      "app_id": "...",
      "user_id": "tevi_user_id",
      "exchange_id": "...",
      "type": "deposit"
    }
  }
}
```

Webhook receiver requirements:

- Tevi posts to `<webhook_url>`.
- Request header includes `X-TEVI-SIGNATURE`.
- Receiver must verify signature with `verify_webhook_signature()` before processing.
- Wallet credit must be idempotent by Tevi provider event ID / normalized idempotency key before any balance mutation.

### 3.6 Manual Cashout Flow

Manual Stars cashouts use:

```http
POST /api/v1/payments/cashout
X-API-Key: <TEVI_API_KEY>
Idempotency-Key: <UUIDv4>
```

Payload:

```json
{
  "rewards": [
    {
      "user": "tevi_user_id",
      "amount": 12
    }
  ],
  "description": "China Slot Game cashout cashout_..."
}
```

Rules:

- Requires API key scope `payment.write`.
- Deducts Stars from the host/app billing account and credits the Tevi user.
- `Idempotency-Key` is required.
- Idempotency window is 24 hours.
- Reuse with a different payload returns `409`.
- The game must derive the payout idempotency key from the authoritative cashout request ID, not from a client-supplied value.
- The cashout request transaction validates the authenticated player, requested amount, available internal Stars balance, compliance gates, self-exclusion state, cashout limits, host float, and Tevi readiness before acceptance.
- Accepted cashout requests reserve or debit the internal wallet balance, create an immutable cashout request/dispatch record, and commit before Tevi provider dispatch.
- Cashout dispatch happens after the internal cashout transaction commits, with retry and reconciliation.
- Cashout failure must never corrupt the internal wallet ledger; retryable failure remains reconcilable and terminal failure requires operator review or compensating action.

## 4. Locked Product Decisions

- Currency model: Tevi Stars end-to-end.
- Denomination: `1 Tevi Star = 1 in-game credit`.
- Bet model: players bet directly in Stars.
- Balance model: internal wallet values are integer minor units representing Stars.
- Production starting balance: `0` Stars.
- Existing `defaultCoins: 100000` becomes sandbox/demo-only seed behavior and must not apply to production Tevi players.
- UI labels for balance, bet, win, jackpot, free-spin win totals, and receipts must say Stars.
- Cashout transfers a player-selected amount of available internal Stars from the host account to the Tevi user after the game accepts the cashout request.
- No fiat conversion, real-cash withdrawal path, crypto withdrawal, or game-managed off-platform redemption in v1.
- Payout timing: user-initiated after gameplay, when the player submits a valid cashout amount through the game UI.
- Top-up credits internal Stars wallet idempotently through Tevi webhook processing.
- Server is authoritative for RNG, wager, win, balance, ledger, cashout request validation, wallet debit/reservation, dispatch status, reconciliation status, and float guard decisions.
- Jackpot remains in scope as a progressive feature, but it must have a configurable hard ceiling and reserve funding.
- Free Spins remain in scope, but real-value winnings from a trigger must have a configurable cap.

## 5. Economy Defaults And Tunables

All values in this section are configurable defaults and must be stored in versioned configuration or operator settings before real-value play.

- Total bet range: configurable default `1` to `20` Stars per spin.
- Target RTP: configurable default `92%`; must be verified through `packages/game-math` simulator before real-value play.
- Max win cap per spin: configurable default `min(2000x line bet, 20000 Stars)`.
- Jackpot trigger: `6x Jackpot symbols` per existing product direction.
- Jackpot start: configurable default `1000` Stars.
- Jackpot hard ceiling: configurable starting value `50000` Stars.
- Jackpot reserve funding: configurable default approximately `1%` of each bet.
- Free Spins trigger: `5 Scatters -> 5 free spins`.
- Free Spins per-trigger winnings cap: configurable starting value `500x line bet`.
- Host float alert threshold: configurable default alert when host float falls below `20%` of target float.
- Host float hard-stop rule: block spins where maximum possible payout exceeds remaining available host float.

## 6. Scope

### 6.1 In Scope

Phase 1 - Sandbox MVP:

- Tevi JWT verification through cached JWKS.
- Tevi token exchange and refresh support.
- Internal `player_id` mapping from Tevi `user_id`.
- Mini App SDK adapter in `js/teviClient.js`.
- Public Mini App hosting configuration for sandbox.
- Backend top-up signature endpoint: `POST /api/v1/payments/top-up-signature`.
- SDK top-up flow using `window.TeviJS.topup()`.
- Webhook receiver with `X-TEVI-SIGNATURE` verification.
- Idempotent `user_topup` wallet crediting through provider top-up idempotency records.
- Stars wallet balance display and server-owned balance refresh.
- Server-authoritative spin using existing canonical `packages/game-math` logic.
- Manual cashout request flow in the game UI, backed by Tevi `POST /api/v1/payments/cashout` after internal cashout acceptance.
- Cashout idempotency, retry, status tracking, and reconciliation.
- Basic Tevi Message receipts for wins and top-ups.
- RTP verification through simulator before sandbox real-value testing.
- Integration tests against PostgreSQL for money paths.
- Verification playbook with per-step Check Rounds.

Phase 2 - Hardening, Compliance, And Production Gate:

- Legal counsel review as a hard production gate.
- Permitted-jurisdiction geo-gating.
- 18+ age gate.
- KYC gating through Tevi identity where available.
- Terms, Privacy, Responsible-Gaming, risk disclosures, and support flow.
- Deposit limits and self-exclusion.
- Host float / budget-service guardrails.
- Jackpot ceiling and reserve accounting.
- Observability dashboards, alerts, and audit retention.
- Security review for JWT, API key, webhook, idempotency, and money-path handling.
- Tevi API key/secret approval.
- Production cutover plan and rollback plan.

Phase 3 - Polish:

- Richer Tevi Message notifications.
- UX polish for Mini App launch, top-up, balance, spin, free-spin, jackpot, cashout, and error states.
- Analytics for funnel, retention, economy, and operational health.
- Free-spin and jackpot tuning based on simulator and observed sandbox data.

### 6.2 Out Of Scope For V1

- Fiat withdrawal.
- Real-cash withdrawal.
- Game-managed currency conversion.
- Crypto withdrawal or payout.
- Additional Tevi apps beyond the single active app.
- New game math beyond fixing known configuration/RTP issues required for safe Tevi launch.
- Client-side RNG or client-authoritative balance in production.

## 7. Functional Requirements

### TEVI-FR-1: Launch As A Tevi Mini App

The game must be hostable as a Tevi Mini App with registered `app_url`, `webhook_url`, scopes, and active channel.

Consequences:

- The existing static Phaser client remains playable inside Tevi H5/Mini App context.
- The app loads `https://static.tevicdn.com/helper_tevi.js` in Tevi mode.
- `js/teviClient.js` detects `window.TeviJS`, initializes Mini App UI affordances, and exposes Tevi auth/top-up/message helpers to the game.
- Local/demo mode remains available only for non-reward visual development.
- Production Tevi mode must not seed `defaultCoins:100000` for real players.

Check Round acceptance requirement:

- The implementation story for this requirement must end with a Check Round showing app launch inside sandbox, SDK presence, app URL registration, and local/demo mode separation.

### TEVI-FR-2: Authenticate Tevi Users And Map Identity

The backend must authenticate Tevi users by verifying RS256 JWTs through cached JWKS from `GET /api/v1/auth/jwks`, then map Tevi `user_id` to internal `player_id`.

Consequences:

- Invalid, expired, wrong-app, inactive, anonymous-disallowed, or unverifiable tokens are rejected without creating gameplay state.
- Valid Tevi users create or reuse a provider identity mapping.
- Internal sessions and wallets reference stable internal `player_id` values.
- JWT verification failures are logged with request ID and safe diagnostic reason.

Check Round acceptance requirement:

- The implementation story must include Check Rounds for JWKS fetch + JWT verify, token exchange/refresh, and auth middleware on a protected route.

### TEVI-FR-3: Exchange And Refresh Tevi Tokens

The backend/client integration must support the Tevi token flow through `GET /api/v1/auth/token?app_id=...` using `Authorization: Bearer <TEVI_TOKEN>` and must handle access-token refresh before expiry.

Consequences:

- The Mini App obtains `data.userInfo.user_app_token` through `window.TeviJS.getUserInfo({is_popup, app_id}, cb)`.
- The integration exchanges that token for Tevi access and refresh tokens.
- Tokens are not stored in committed source or logs.
- Token refresh failures produce a recoverable re-authentication path.

Check Round acceptance requirement:

- The implementation story must include curl examples for Tevi token exchange, expected response shape, local protected route behavior, and log correlation by `requestId`.

### TEVI-FR-4: Issue Backend Top-Up Signatures

The backend must expose `POST /api/v1/payments/top-up-signature` to issue Tevi deposit tokens for authenticated users and requested Star amounts.

Consequences:

- Endpoint requires authenticated Tevi user context.
- Amount is validated as integer Stars and must satisfy configured deposit limits.
- The backend signs or requests the deposit token using Tevi-approved credentials and environment settings.
- The response returns `{deposit_token}` using the existing API envelope.
- Missing, invalid, or unauthorized token generation fails without wallet mutation.

Check Round acceptance requirement:

- The implementation story must include a Check Round for backend top-up-signature issue with curl request/response, headers, logs, and failure cases.

### TEVI-FR-5: Run SDK Top-Up In The Mini App

The client must use `window.TeviJS.topup({amount, deposit_token, channel_id, metadata}, cb)` to let users top up Stars through Tevi sandbox confirmation UI.

Consequences:

- The client calls the backend for `deposit_token` before invoking SDK top-up.
- A successful SDK callback is treated as pending until the webhook credit is processed.
- The UI shows top-up pending, credited, failed, and retry states.
- Missing `deposit_token` must surface the Tevi `403` failure in the verification flow.

Check Round acceptance requirement:

- The implementation story must include a Mini App manual top-up Check Round using the sandbox card, expected SDK callback, pending UI state, and webhook follow-through.

### TEVI-FR-6: Verify Webhooks And Credit Wallets Idempotently

The backend must receive Tevi `user_topup` webhooks, verify `X-TEVI-SIGNATURE`, and credit the internal Stars wallet exactly once.

Consequences:

- Signature verification happens before parsing effects or wallet mutation.
- Duplicate webhook delivery does not double-credit the wallet.
- `provider_topup_idempotency` / `tevi_topup_idempotency` records store event ID, normalized key, user mapping, amount, status, timestamps, and raw provider metadata.
- Wallet credit and idempotency completion commit atomically in PostgreSQL.
- Unknown users, invalid metadata, amount mismatches, and signature failures are handled without unsafe crediting.

Check Round acceptance requirement:

- The implementation story must include webhook replay proof: resend the same webhook and show no double-credit in wallet ledger or idempotency table.

### TEVI-FR-7: Use Stars Wallet For Balance, Bets, And Wins

The game must display and mutate Stars balances only through server-owned wallet APIs and spin responses.

Consequences:

- UI labels show Stars for balance, bet, win, jackpot, and receipts.
- Production users start at `0` Stars unless credited by Tevi top-up or approved admin/test fixture in sandbox.
- Bets are integer Stars and must be in configured range, default `1-20` Stars per spin.
- Insufficient balance, deposit-limit blocks, self-exclusion, jurisdiction blocks, and float hard stops produce clear user-facing states.
- Free-spin state is server-owned and cannot be forged by the client.

Check Round acceptance requirement:

- The implementation story must include manual game actions showing top-up changes balance, spin debits wager, wins update internal balance, and all values display as Stars.

### TEVI-FR-8: Keep Server-Authoritative Spin And Ledger

Every production Tevi spin must be resolved by the backend using canonical game math in `packages/game-math`, with idempotency by `sessionId + clientSpinId` and durable wallet/ledger writes.

Consequences:

- Client-provided RNG, result, win amount, jackpot award, or balance is ignored.
- The spin transaction commits internal debit, win credit, spin ledger, wallet transactions, idempotency record, and request trace before returning success.
- Duplicate retries with the same payload return the original result.
- Duplicate retries with different payload return idempotency conflict.
- p95 spin response target remains under 300ms excluding client animation and excluding post-commit cashout dispatch.

Check Round acceptance requirement:

- The implementation story must include a server spin debit/win Check Round with curl, UI interaction, ledger SQL, idempotency retry proof, and expected response envelope.

### TEVI-FR-9: Accept Manual Cashout Requests And Dispatch After Commit

The backend must accept authenticated manual cashout requests for player-entered Star amounts and dispatch Tevi Stars cashout only after the internal cashout transaction commits.

Consequences:

- Cashout request amount is validated as integer Stars against available internal wallet balance, cashout limits, compliance gates, self-exclusion state, host float, and Tevi readiness.
- Cashout idempotency key is derived from the authoritative cashout request ID and represented as a UUIDv4-compatible key.
- Cashout request uses `POST /api/v1/payments/cashout`, `X-API-Key`, and `Idempotency-Key`.
- Payload rewards the Tevi `user_id` for the exact accepted cashout amount in Stars.
- Internal wallet ledger records the cashout debit or reservation before provider dispatch.
- Internal ledger remains correct if Tevi cashout fails, times out, or returns retryable errors.
- Cashout status is stored as pending, dispatched, succeeded, failed_retryable, failed_terminal, or reconciled.
- Retry/reconciliation can prove no double-payout.

Check Round acceptance requirement:

- The implementation story must include manual cashout amount-entry and idempotency Check Rounds, including insufficient-balance rejection, replay with the same `Idempotency-Key`, and conflict behavior for changed payloads.

### TEVI-FR-10: Reconcile Cashout Failures

The backend must reconcile post-commit manual cashout failures so payout state is visible, retryable where safe, and auditable.

Consequences:

- A simulated payout failure leaves the cashout request record, spin ledger, and internal wallet correct.
- Retryable failures are queued or discoverable by reconciliation job.
- Terminal failures require operator review and compensating action workflow.
- Reconciliation status is visible in logs, DB, and admin/support search.

Check Round acceptance requirement:

- The implementation story must include a simulated payout failure Check Round with logs, DB rows, retry command, and pass/fail criteria.

### TEVI-FR-11: Send Tevi Message Receipts

The system must send basic Tevi Message receipts for completed top-ups and manual cashout payouts.

Consequences:

- Top-up receipt includes credited Stars amount and correlation ID.
- Cashout receipt includes cashout request ID, Star amount, and cashout status.
- Message failures do not roll back wallet or cashout state.
- Message dispatch status is logged and retryable where appropriate.

Check Round acceptance requirement:

- The implementation story must include a Message receipts Check Round with request/response examples and user-visible receipt verification.

### TEVI-FR-12: Validate RTP Before Real-Value Play

The active Tevi game configuration must be validated with the `packages/game-math` simulator before sandbox real-value testing and before production exposure.

Consequences:

- Target RTP default is configurable `92%`.
- Simulator output must include observed RTP, confidence/tolerance, hit rate, largest win, free-spin trigger frequency, jackpot trigger frequency, and max exposure.
- Known math/config issues from the existing PRD addendum must be fixed or explicitly neutralized before launch.
- No production Tevi play is allowed with unverified RTP.

Check Round acceptance requirement:

- The implementation story must include an RTP simulation Check Round with exact command, seed, config version, result artifact, and pass/fail tolerance.

### TEVI-FR-13: Enforce Host Float And Budget Guardrails

The backend must prevent accepted spins from creating payout exposure that the host Stars float cannot cover.

Consequences:

- Budget-service guardrails track configured target float, remaining available float, jackpot reserve, and maximum possible payout for a requested spin.
- Alert when float is below configurable `20%` of target.
- Hard-stop spins whose maximum possible payout exceeds remaining available float.
- Jackpot reserve is funded by configurable default approximately `1%` of each bet.
- Jackpot hard ceiling defaults to configurable starting value `50000` Stars.
- Guardrail decisions are logged and auditable.

Check Round acceptance requirement:

- The implementation story must include a float guardrails Check Round showing alert threshold, hard-stop behavior, UI error, logs, and DB state.

### TEVI-FR-14: Apply Compliance Gates Before Production

Production Tevi exposure must be blocked until compliance gates are complete.

Consequences:

- Legal counsel review is a hard gate.
- Permitted-jurisdiction geo-gating is active.
- 18+ age gate is active.
- KYC gating uses Tevi identity where available.
- Terms, Privacy, Responsible-Gaming, deposit limits, self-exclusion, and support/dispute workflows are live.
- Audit log and ledger retention policies are documented and implemented.
- Tevi API Key and Secret Key approval is complete.

Check Round acceptance requirement:

- Phase 2 stories must include Check Rounds showing blocked access for non-compliant states and successful access for permitted test users.

## 8. Non-Functional Requirements

- TEVI-NFR-1 Integrity: no duplicate top-up credit, no duplicate cashout payout, no negative wallet corruption, and no unledgered Star mutation under retries, crashes, or webhook replay.
- TEVI-NFR-2 Security: secrets are supplied by environment only; Tevi JWTs, API keys, refresh tokens, deposit tokens, and webhook secrets are never committed or logged in full.
- TEVI-NFR-3 Observability: every money-path request logs `requestId`, correlation ID where available, Tevi event ID where available, internal player/session/spin IDs where applicable, and safe status/error codes.
- TEVI-NFR-4 Performance: p95 spin remains under 300ms excluding client animation and excluding post-commit cashout dispatch.
- TEVI-NFR-5 Durability: production Tevi mode requires `PERSISTENCE_MODE=postgres` and must fail safe if PostgreSQL, migrations, schema readiness, or required secrets are missing.
- TEVI-NFR-6 Auditability: top-ups, wallet credits, spin debits, spin wins, cashout dispatches, reconciliation actions, Message sends, float guard decisions, and compliance gates are retained and queryable.
- TEVI-NFR-7 Testability: all money paths have PostgreSQL integration tests and replayable manual Check Rounds.
- TEVI-NFR-8 Compliance: production deployment is treated as real-money-style gaming and cannot proceed without legal/compliance sign-off.

## 9. Required Environment And Configuration

Required Tevi environment variables:

- `TEVI_APP_ID`
- `TEVI_API_KEY`
- `TEVI_SECRET_KEY`
- `TEVI_API_BASE`
- `TEVI_JWKS_URL`
- `TEVI_WEBHOOK_SECRET`

Required existing/runtime environment variables:

- `DATABASE_URL`
- `PERSISTENCE_MODE=postgres`
- `NODE_ENV`

Environment defaults by mode:

- Sandbox `TEVI_API_BASE`: `https://developer-api.sbx.tevi.dev`
- Sandbox `TEVI_JWKS_URL`: `https://developer-api.sbx.tevi.dev/api/v1/auth/jwks`
- Production `TEVI_API_BASE`: `https://developer-api.flowstreamx.com`
- Production portal approval and key issuance are required before production secrets exist.

Configurable economy/operator settings:

- Min bet Stars.
- Max bet Stars.
- Target RTP.
- Max win cap per spin.
- Jackpot start.
- Jackpot ceiling.
- Jackpot reserve percentage.
- Free-spin trigger cap.
- Deposit limits.
- Self-exclusion state.
- Permitted jurisdictions.
- Host target float.
- Float alert threshold.
- Float hard-stop policy.

## 10. Endpoint Inventory

Game-owned endpoints to implement or protect:

- `POST /api/v1/payments/top-up-signature` - issue backend Tevi deposit token for an authenticated user and amount.
- `POST /api/v1/webhooks/tevi` - receive Tevi webhooks, verify `X-TEVI-SIGNATURE`, process `user_topup` idempotently.
- `POST /api/sessions` - start/resume game session, now backed by Tevi identity in Tevi mode.
- `GET /api/me/balance` - return internal Stars wallet balance and server-owned free-spin/jackpot state.
- `POST /api/spins` - server-authoritative spin with `sessionId + clientSpinId` idempotency.
- `GET /api/spins/:spinId` - owner/support-safe spin detail including payout/cashout status where authorized.
- `POST /api/v1/payments/cashout-requests` - accept authenticated manual cashout requests for player-entered Star amounts and create retry-safe provider dispatch state.
- `GET /api/ready` - readiness including PostgreSQL, schema readiness, required Tevi config in Tevi mode, and safe provider connectivity checks where appropriate.

Tevi endpoints consumed by the integration:

- `GET /api/v1/auth/jwks`
- `GET /api/v1/auth/token?app_id=...`
- `GET /api/v1/auth/user`
- `GET /api/v1/auth/user/balance`
- `POST /api/v1/payments/cashout`

Frontend SDK methods used:

- `window.TeviJS.getUserInfo({is_popup, app_id}, cb)`
- `window.TeviJS.topup({amount, deposit_token, channel_id, metadata}, cb)`
- `window.TeviJS.loadConfig({optionMenu, layoutMode, config, version})`
- `window.TeviJS.showBackButton()`
- `window.TeviJS.showCloseButton()`
- `window.TeviJS.quitGame()`

## 11. Data And Ledger Requirements

The persistence model must support the following Tevi-specific records or equivalent fields:

- Provider identity mapping: Tevi `user_id` -> internal `player_id`.
- Tevi token/session metadata without storing secrets unsafely.
- Top-up signature issuance record with amount, requester, deposit token fingerprint, status, and request ID.
- Tevi top-up idempotency record with provider event ID, normalized key, status, player ID, amount, raw metadata, timestamps, and failure reason.
- Wallet transaction for top-up credit.
- Spin ledger row with wager, payout, config version, win breakdown, jackpot/free-spin state, balance before/after, request ID, and idempotency key.
- Cashout request/dispatch record with cashout request ID, player ID, Tevi user, requested amount, wallet transaction or reservation reference, idempotency key, payload fingerprint, status, attempt count, provider response, and reconciliation state.
- Message dispatch record with message type, recipient, source event, status, attempt count, and provider response.
- Host float/budget records for target float, observed float, reserve, alerts, hard stops, and audit events.
- Compliance gate records for geo, age, KYC, deposit limits, self-exclusion, terms acceptance, and legal/prod approval state.

All Star-denominated amounts must use integer minor units.

## 12. Verification Checkpoint Policy

Implementation must proceed in small, independently verifiable steps. After each step, the implementer must stop and provide a Check Round. Work must not continue until the human confirms the Check Round passed.

Each Check Round must include:

1. What changed: files touched and why.
2. How to run it: exact commands for env setup, build, migrations, and sandbox start.
3. Observe the requests: concrete curl examples for every endpoint exercised, including status/body and headers such as `Authorization: Bearer`, `X-API-Key`, `X-TEVI-SIGNATURE`, and `Idempotency-Key` where relevant.
4. Interact with the game: manual Mini App actions and expected UI state for Stars balance, bet, win, pending top-up, cashout, errors, and receipts.
5. Inspect state: logs to watch and exact SQL for wallet ledger, provider top-up idempotency, spin ledger, cashout request/dispatch, Message dispatch, request traces, and guardrail state.
6. Pass/fail criteria: explicit expected outcome plus common failure signatures and debug hints.
7. Idempotency / edge proof where relevant: replay webhook, retry spin, retry cashout, or simulate payout failure and prove no double-credit/double-payout.

Suggested Check Round order:

1. JWKS fetch + JWT verify.
2. Token exchange/refresh.
3. Auth middleware on a protected route.
4. Backend top-up-signature issue.
5. SDK top-up in the Mini App.
6. `user_topup` webhook receipt + signature verify + idempotent credit.
7. Server spin debit/win.
8. Manual cashout amount entry + idempotency.
9. Reconciliation on a simulated payout failure.
10. Message receipts.
11. RTP simulation.
12. Float guardrails.

## 13. Acceptance Criteria And Definition Of Done

Phase 1 is done when:

- A Tevi sandbox user can launch the Mini App.
- The user can authenticate with JWT verified through JWKS.
- Tevi `user_id` maps to stable internal `player_id`.
- The user can request a backend top-up signature.
- The user can top up Stars using Tevi SDK and sandbox card.
- Tevi `user_topup` webhook credits the internal Stars wallet idempotently.
- The user can spin with server-authoritative RNG, wager validation, outcome calculation, and ledger mutation.
- The user can manually cash out an available Stars amount through the game UI, with idempotency and reconciliation state.
- Top-up and cashout Message receipts are sent or safely tracked for retry.
- RTP is verified by `packages/game-math` simulator within tolerance of configurable `92%` target.
- Integration tests cover all money paths against PostgreSQL.
- Webhook replay does not double-credit.
- Cashout retry does not double-payout.
- Spin retry does not double debit or double credit.
- All Check Rounds for Phase 1 pass and are represented in `verification-playbook.md`.

Phase 2 is done when:

- Legal counsel review approves production exposure.
- Permitted-jurisdiction geo-gating, 18+ gate, KYC where available, Terms, Privacy, Responsible-Gaming, deposit limits, and self-exclusion are active.
- Host float guardrails, jackpot ceiling, reserve accounting, alerts, observability, and audit retention are active.
- Security review is complete.
- Tevi API Key and Secret Key approval is complete.
- Production cutover and rollback playbook are approved.

Phase 3 is done when:

- Message receipts, UX polish, analytics, and free-spin/jackpot tuning are complete without weakening Phase 1/2 controls.

## 14. BMAD Handoff Notes

- Deliverable 2 must update `_bmad-output/planning-artifacts/architecture.md`, especially the existing `Tevi Readiness Boundary`, to replace future-only idempotency with concrete Tevi auth, top-up, webhook crediting, cashout, Message, and float-guardrail wiring.
- Deliverable 3 must create epics and stories grouped by Phase 1, Phase 2, and Phase 3.
- Every epic/story must end with its own Check Round acceptance criteria using the mandatory verification format in this addendum.
- Deliverable 4 must produce an implementation-readiness checklist covering env vars, secrets, migrations, endpoints, tests, observability, compliance gates, and rollback.
- Deliverable 5 must produce `_bmad-output/verification-playbook.md` with replayable human verification steps, request/response examples, SQL, logs, UI steps, pass/fail criteria, and idempotency proofs.

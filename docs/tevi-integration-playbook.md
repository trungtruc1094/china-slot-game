# Tevi Integration Playbook (Verified Contracts & Gotchas)

**Purpose:** Hard-won, *verified-against-the-running-sandbox* knowledge for integrating a web game (Mini App) with Tevi auth + Stars payments. Written so (a) upcoming China Slot stories (8.6+) don't re-hit these issues, and (b) future game integrations can reuse it directly.

**Status of evidence:** Everything marked ✅ "verified" below was confirmed end-to-end in the Tevi sandbox on 2026-06-30 via the China Slot mini app (`chinareel.pleagamehub.com`) + backend `china-slot-api` on Render. The official docs at `docs.tevi.com` are **incomplete and occasionally contradictory** — where docs and runtime disagreed, runtime won, and that's noted.

> ⚠️ **Biggest meta-lesson:** Do **not** trust the Tevi docs' field shapes. The real `helper_tevi.js` SDK and the live runtime responses are the source of truth. Several "documented" shapes were wrong (booleans that are actually numbers, `deposit_token` that is actually `data.token`, `channel_id` that must come from the deposit-token payload, etc.). Build adapters that tolerate/normalize, and instrument the real responses (see Diagnostics).

---

## 1. Architecture (who calls what)

```
Browser (Mini App, plain JS)                Your backend (api)                 Tevi
─────────────────────────────              ───────────────────               ──────────────
TeviJS.getUserInfo() ───────────────────────────────────────────────────────▶ returns user_app_token
  user_app_token ──▶ POST /api/v1/payments/top-up-signature (Bearer user_app_token)
                                            ──▶ POST {TEVI}/api/v1/payments/top-up-signature
                                                 (Bearer user_app_token, body {amount})
                                            ◀── { data: { token } }   (the deposit token)
  ◀── { data: { deposit_token } }
TeviJS.topup({ amount, deposit_token,
   channel_id (UUID from token), metadata }) ─────────────────────────────────▶ charge + later webhook
  callback { call: "ok" } ──▶ UI "pending"
                                            ◀── webhook user_topup  ──▶ credit wallet (Story 8.6)
```

- **Client** captures intent, forwards the user token, invokes the SDK, shows pending/failure. Never signs tokens, never credits.
- **Backend** verifies the Tevi JWT, issues the deposit token by calling Tevi with the *forwarded user token*, and (Story 8.6) verifies the webhook + credits the wallet atomically.
- **Crediting only happens via the `user_topup` webhook** — a successful `topup` SDK callback means *pending*, never *credited*.

---

## 2. Auth: `getUserInfo` and the Tevi JWT  ✅ verified

### `TeviJS.getUserInfo({ is_popup, app_id }, cb)` response shape
Real runtime shape (NOT the docs' `data.userInfo`):
```js
{ action: "...", call: "ok", userInfo: { user_app_token, device_id, user_slug } }
```
- `userInfo` is **top-level**, there is **no `data` wrapper**. Read `response.userInfo.user_app_token`.
- Success indicator is `call: "ok"`; a truthy `error_code` (or non-`ok` `call`) indicates failure.
- Adapter should tolerate both `response.userInfo` and `response.data.userInfo`.

### The Tevi JWT (`user_app_token` / exchanged `access_token`) claims  ✅ verified
Verified against a real sandbox token. **Claims are NUMERIC where you'd expect booleans/strings:**

| Claim | Real type/value | Naive assumption that breaks |
|---|---|---|
| `user_is_active` | **number** `1` (active) / `0` (inactive) | `=== true` (boolean) |
| `user_anonymous` | **number** `0` / `1` | `typeof === "boolean"` |
| `user_id` | **number** (e.g. `3033448852`) | `typeof === "string"` |
| `app_id` | string (e.g. `AZX29173`) | — |
| `exp` | present (~24h) | — (was fine) |

**Verifier rule:** coerce. Treat `1/"1"/true/"true"` as truthy, `0/"0"/false/"false"` as falsy; accept numeric `user_id` and stringify it for the subject. (See `apps/api/src/domain/tevi-auth-adapter.ts` for the China Slot implementation.)

### JWKS  ✅ verified
- Sandbox JWKS: `https://developer-api.sbx.tevi.dev/api/v1/auth/jwks`
- Must be a **full HTTPS URL including the path** (a bare host fails validation/boot).
- Docs also list `developer-api.flowstreamx.com` — use the host that matches your token issuer; for sandbox it's `sbx.tevi.dev`.

### Token exchange
`GET {TEVI}/api/v1/auth/token?app_id=...` with `Authorization: Bearer <user_app_token>` → `{ data: { access_token, refresh_token } }` (JWTs; access ~24h, refresh ~24w). For payment calls you can forward the `user_app_token` directly (see §3) — exchange is for establishing a server session.

---

## 3. Payments: deposit-token issuance  ✅ verified

### Endpoint
`POST {TEVI}/api/v1/payments/top-up-signature` (sandbox base `https://developer-api.sbx.tevi.dev`).
- The path is `/api/v1/payments/top-up-signature` — **not** `/deposit-token`.
- **Must be called from your backend** (CORS + secrecy), then pass the resulting deposit token to the client.

### Auth + body  ⚠️ docs were ambiguous; runtime verified
- **Auth: `Authorization: Bearer <user_app_token>`** — the **end user's** token, **forwarded** from the client. Authenticating with the app API key / `x-tevi-secret-key` returns **401 PROVIDER_REJECTED**.
- **Body: `{ "amount": <int> }` only.** Do not send app_id/channel/player-id fields.
- Requires the app to be approved for the **`payment.write`** scope.
- Implication for backend design: the auth middleware must **retain the raw bearer token** and thread it through to the Tevi call (not just the decoded identity).

### Response shape  ✅ verified
```js
{ success: true, data: { token: "<deposit token>" }, message: "Success", error_code: "" }
```
- The deposit token is at **`data.token`** — **not** `data.deposit_token`. Parse defensively (`data.token` ?? `data.deposit_token` ?? top-level).

---

## 4. SDK `topup()`  ✅ verified

### Call
```js
window.TeviJS.topup({
  amount,           // integer Stars
  deposit_token,    // from the top-up-signature response (data.token)
  channel_id,       // UUID — SEE BELOW
  metadata          // safe correlation only (type, requestId, attemptId); NO secrets
}, callback);
```

### `channel_id` must be the **UUID from the deposit-token payload**  ✅ verified (key gotcha)
- Passing the configured numeric billing channel (e.g. `2300210851`) → callback fails with **`msg: "Must be a valid UUID"`**.
- The correct value is a UUID (e.g. `ac4db388-4e4d-4a26-9ba9-18f741e95749`) **encoded inside the deposit token's JWT payload**. Decode the deposit token (base64url middle segment) and read `channel_id` (fallback `billing_channel_id`). Never log the deposit token while doing so.

### Callback contract  ✅ verified
- **Success: `response.call === "ok"`.** Treat anything that is not explicitly `"ok"` as failure — do **not** optimistically mark pending.
- **Failure: `response.call === "fail"`**, with detail in `response.msg` / `response.response` (e.g. `msg: "Insufficient balance."`). Shape: `{ action, call, response, msg }`.
- Generic SDK bridge errors use numeric `error_code`: **`-14` timeout, `-5` not ready, `-6` device unavailable** (treat as retryable).
- Always add your own timeout (the SDK may not call back) — recoverable failure on timeout.

### Insufficient Stars  ✅ observed
- If the user lacks Stars, `topup` returns `msg: "Insufficient balance."` and Tevi opens a **"Purchase Star"** sheet to buy more.
- In the sandbox (2026-06-30) that **Purchase Star sheet itself returned `internal_server_error`** — a **Tevi-side bug**, not yours. To test the happy path you need a sandbox account already funded with Stars (via Tevi tooling/support).

---

## 5. Webhook `user_topup` (for crediting — Story 8.6)  📄 from docs (not yet runtime-verified)
```json
{ "id": "...", "event": "user_topup", "space_id": "...", "created_at": "...",
  "data": { "user": "633505726", "amount": 1000,
            "metadata": { "app_id": "...", "user_id": 633505726, "exchange_id": "...", "type": "deposit" } } }
```
- Signature header is **`X-Tevi-Signature`** (note casing).
- Verification = **HMAC-SHA256** over the **compact JSON** of the payload (`json.dumps(payload, separators=(",", ":"))`), hex digest, constant-time compare, keyed with the dashboard webhook secret.
- Cashout webhook is `user_withdraw` (same shape, `type: "refund"`).
- **Verify signature before parsing/mutating**; credit + idempotency must commit atomically.

## 6. Cashout (for Story 8.8)  📄 from docs
`POST {TEVI}/api/v1/payments/cashout` — auth is **`X-API-Key`** (server-to-server, *different* from top-up which uses the user token), `Idempotency-Key` (UUIDv4, expires 24h, conflicting reuse → 409), body `{ rewards: [{ user, amount }], description }`.

---

## 7. Backend env / config requirements  ✅ verified
The top-up route is **conditionally mounted** — it only exists when **both** Tevi auth and Tevi payment are configured. Missing config → the route silently **404s** (not an error you'll spot without checking).

Required env (China Slot names; see `apps/api/src/config/env.ts`):
- Auth: `TEVI_APP_ID`, `TEVI_JWKS_URL` (full https URL w/ path), `TEVI_API_BASE`
- Payment: `TEVI_PAYMENT_ENABLED=true`, `TEVI_API_KEY`, `TEVI_SECRET_KEY`, `TEVI_BILLING_CHANNEL_ID`, `TEVI_PAYMENT_API_BASE`, **`TEVI_DEPOSIT_TOKEN_PATH=/api/v1/payments/top-up-signature`**, `TEVI_DEPOSIT_MIN_STARS`/`TEVI_DEPOSIT_MAX_STARS`
- Generic SDK truthiness/limits: client UX cap via `CHINA_SLOT_TEVI_CONFIG.topup.maxStars` (backend is authoritative).

---

## 8. Diagnostics that made this tractable  ✅ verified technique
You usually **cannot open a console inside the Tevi mobile webview**. Two techniques unblocked everything:

1. **On-screen debug panel** (`?tevi=1&debugTevi=1`): a fixed DOM overlay that prints **token-safe** summaries — key names + booleans, never token values — of `getUserInfo` and `topup` responses (shape, `call`, resolved state, decoded non-secret claims like `user_is_active`, the `channel_id` being sent). See `js/teviClient.js`.
2. **Backend Render logs** (`render logs` / dashboard): structured `[tevi-auth]`, `[tevi-payment]`, `[tevi-topup]` lines with `reasonCode`s and a **`responseShape`** (key names only) when a provider response fails to parse. Correlate to the browser via the `x-request-id` (`req_browser_…`).

**Principle:** when a provider response doesn't match, log its *shape* (key names/types), never its values — that's how we found `data.token`, top-level `userInfo`, numeric claims, and the UUID `channel_id`.

---

## 9. Ops / deploy gotchas  ✅ verified
- **Static client caching:** `index.html` script tags need **cache-busting** (`?v=<token>`), otherwise redeploys are shadowed by browser/CDN/**webview** caches and you debug stale code. Bump the token each deploy (or wire it to the commit SHA / Jekyll `site.github.build_revision`).
- **Render free tier cold start:** spins down after ~15 min idle; the first request after idle fails while it wakes (~30–60s). Warm `/health` before testing, or expect the first balance/spin to fail.
- **`docs.tevi.com` is a JS-rendered SPA** — server-side fetch only returns the marketing shell. To read it, use a real browser. The plain-JS `helper_tevi.js` *can* be fetched and is authoritative for SDK behavior.

---

## 10. Reusable checklist for the NEXT game ↔ Tevi integration
1. Load `helper_tevi.js` only in explicit Tevi mode; detect `window.TeviJS`.
2. Auth: read `user_app_token` from **top-level `userInfo`**; success = `call: "ok"`.
3. Backend verifier: **coerce numeric** `user_is_active`/`user_anonymous`/`user_id`; JWKS = full sandbox URL.
4. Deposit token: backend forwards **`Bearer <user_app_token>`** + body `{ amount }` to `/api/v1/payments/top-up-signature`; parse token at **`data.token`**.
5. SDK `topup`: **`channel_id` = UUID decoded from the deposit token**, not the billing channel id.
6. Treat `call === "ok"` as the only success; everything else is failure; add a timeout.
7. Crediting is webhook-only (`user_topup`, `X-Tevi-Signature` HMAC-SHA256).
8. Cashout uses `X-API-Key` + `Idempotency-Key` (different auth from top-up).
9. Gate the routes behind explicit env flags; confirm they're actually mounted (no silent 404).
10. Ship an on-screen `?debugTevi=1` token-safe panel + structured backend logs from day one.
11. Cache-bust client assets; warm the backend before sandbox tests.
12. Fund the sandbox Tevi account with Stars before testing the charge (and expect the Purchase-Star sandbox path to be flaky).

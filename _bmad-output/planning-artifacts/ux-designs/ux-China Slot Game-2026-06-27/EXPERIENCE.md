---
name: Hi-Lo Tevi Wallet UX
status: final
sources:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
  - imports/README.md
updated: 2026-06-27
---

# Hi-Lo Tevi Wallet UX — Experience Spine

## Foundation

Single-surface mobile Mini App inside Telegram/Tevi shell. The game remains a Phaser/H5 experience; wallet actions are in-game modal surfaces layered over the existing game board and HUD. DESIGN.md is the visual identity reference; this spine owns information architecture, behavior, states, interactions, accessibility, and Check Round expectations.

The Tevi payment model is deposit-first and manual-cashout:

1. Player deposits Tevi Stars into the internal game wallet.
2. Player plays using internal Stars balance.
3. Wins credit the internal Stars wallet.
4. Player manually cashes out a selected available amount through a Cash Out modal.
5. Backend dispatches Tevi cashout only after the internal cashout request transaction commits.

Sources of truth:

- Visual identity: `DESIGN.md`.
- Payment authority: Tevi PRD addendum and architecture Tevi Readiness Boundary.
- Story sequencing: `epics.md` and `sprint-status.yaml`.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Game HUD | Mini App open | Primary game surface, balance visibility, Deposit entry, Menu entry |
| Wallet summary | Menu or wallet/balance tap | Shows available Stars, pending top-ups, pending cashouts, and actions |
| Deposit modal | HUD Deposit button, Wallet summary | Select or enter amount, start Tevi top-up flow |
| Cash Out modal | Wallet summary, Menu, optional HUD cashout entry | Select or enter amount, view receive amount after fee, submit manual cashout |
| Payment pending state | Deposit/Cash Out modal after submit | Show request accepted or waiting for Tevi/webhook/provider state |
| Payment result state | Modal or non-blocking receipt state | Confirm credited, dispatched, succeeded, failed retryable, failed terminal, or operator review |
| Blocked state | Modal inline or blocking panel | Explain compliance, self-exclusion, deposit limit, cashout limit, insufficient balance, Tevi unavailable, or float hard stop |
| Support detail reference | Receipt/status link where available | Gives player/support a reference ID without exposing provider internals |

Modal stack rule: only one game-owned modal at a time. Tevi SDK confirmation is external; when control returns, the game displays a pending state until webhook or provider state is authoritative.

## Voice and Tone

Microcopy is direct and value-safe. It should feel native to the game, but not promotional or casino-like.

| Do | Don't |
|---|---|
| `Select an amount to deposit` | `Add money now!` |
| `Select an amount to withdraw` | `Win real cash` |
| `1% withdrawal fee applies` | Hide or soften fee language |
| `Waiting for Tevi confirmation.` | `Almost rich!` |
| `Cash out request received.` | `Cashout guaranteed` |
| `This amount is higher than your available Stars.` | `Invalid amount` |
| `Cash out is unavailable right now. Try again later.` | `Provider error 503` |
| `You are blocked from value-bearing play.` | Reveal detailed KYC or jurisdiction internals |

Use `Stars` consistently. Do not use fiat, cash, coins, credits, or points when referring to Tevi-backed wallet values unless a legal/compliance copy block explicitly permits it.

## Component Patterns

Behavioral rules. Visual specs live in DESIGN.md Components.

| Component | Use | Behavioral rules |
|---|---|---|
| HUD Deposit button | Bottom game HUD | Opens Deposit modal. Disabled only when session/auth unavailable; blocked deposit limits are handled inside modal with explanation. |
| Wallet action menu | Menu / wallet summary | Provides Deposit and Cash Out actions. Cash Out is visible but disabled with reason when no withdrawable balance exists. |
| Wallet modal shell | Deposit and Cash Out | One modal shell. Close returns to game without mutating server state. Close during pending asks only if cancel is still possible; otherwise closes to background pending state. |
| Amount preset row | Deposit and Cash Out | Presets: 100, 200, 500, 1000, 2000 unless product config overrides. Tap fills custom field and selects preset. |
| Custom amount input | Deposit and Cash Out | Numeric only, integer Stars. Input can override preset. Reject zero, negative, decimal, non-numeric, and over-limit values. |
| Receive field | Cash Out | Read-only. Empty until valid amount. Shows amount after configured fee. [ASSUMPTION: fee is 1% as shown in screenshot unless operator config overrides.] |
| Primary CTA | Deposit and Cash Out | Enabled only when the current amount passes client-side validation. Server can still reject. Text: `DEPOSIT NOW`, `CASH OUT NOW`. |
| Inline status note | Modals | Deposit: trust/security note. Cash Out: fee note. Errors replace or sit above note depending severity. |
| Request status line | Pending/result states | Shows safe state and reference ID where available. Never shows full tokens, signatures, provider payloads, or secrets. |
| Close button | All modals | Closes modal. If a request is pending, background state remains available in wallet summary. |

## State Patterns

### Shared Wallet States

| State | Trigger | Treatment |
|---|---|---|
| Balance loading | Mini App auth/session start | Skeleton or muted placeholder in HUD. Wallet actions disabled. |
| Balance loaded | `GET /api/me/balance` success | HUD shows Stars balance and action affordances. |
| Balance refresh failed | Balance endpoint fails | Keep last known value visibly stale if available; block value-bearing actions until refresh succeeds when required by backend policy. |
| Tevi unavailable | SDK missing or backend readiness fails | Show Deposit/Cash Out unavailable; local demo remains separated from Tevi mode. |
| Re-auth required | Token exchange/refresh fails | Route to Tevi auth recovery. Do not allow deposit, spin, or cashout. |

### Deposit States

| State | Trigger | Treatment |
|---|---|---|
| Empty amount | Deposit modal opens | Presets visible, custom field placeholder `Enter amount`, CTA disabled. |
| Preset selected | Preset tap | Fill field, highlight preset, CTA enabled if allowed. |
| Custom valid amount | Numeric input passes local checks | CTA enabled. Preset highlight clears unless exact match. |
| Invalid amount | Zero, negative, decimal, non-numeric, above configured max | Inline error. CTA disabled. |
| Deposit limit blocked | Server rejects by deposit policy | Inline blocked state with safe reason. No wallet mutation. |
| Signature pending | CTA submit | Disable controls; show `Preparing Tevi deposit.` |
| SDK confirmation open | Tevi SDK owns UI | Game waits; do not mutate wallet. |
| SDK canceled | Player cancels Tevi confirmation | Return to editable Deposit modal with `Deposit canceled.` |
| Webhook pending | SDK success but wallet not credited | Show `Waiting for Tevi confirmation.` and reference if available. |
| Credited | Webhook credit committed | Show success, update wallet balance from backend. |
| Retryable failure | Network/provider retryable error | Offer retry where safe. Keep no wallet credit unless webhook committed. |
| Terminal failure | Provider or backend terminal error | Show safe failure and support reference. |

### Cash Out States

| State | Trigger | Treatment |
|---|---|---|
| Empty amount | Cash Out modal opens | Presets visible, custom field placeholder `Enter amount`, Receive empty, CTA disabled. |
| Preset selected | Preset tap | Fill field, compute Receive if valid. |
| Custom valid amount | Numeric input passes local checks | Show Receive after fee and enable CTA. |
| Insufficient cashout balance | Amount exceeds available Stars | Inline error: `This amount is higher than your available Stars.` CTA disabled. |
| Fee calculated | Valid amount entered | Receive field shows amount minus fee. [ASSUMPTION: round down to integer Stars until policy specifies otherwise.] |
| Cashout limit blocked | Server rejects by limit | Inline blocked state; no wallet mutation. |
| Compliance/self-exclusion blocked | Server rejects eligibility | Blocking state with safe reason; no policy internals. |
| Request pending | CTA submit | Disable controls; show `Submitting cash out request.` |
| Request accepted | Internal transaction committed | Show pending dispatch state and update available wallet balance from backend. |
| Dispatched | Provider call sent | Show `Cash out is being processed.` |
| Succeeded | Provider confirms | Show success and receipt/reference ID. |
| Failed retryable | Provider/network uncertainty | Show retry state; operator/support can retry with same idempotency key. |
| Failed terminal | Provider terminal failure | Show `Cash out needs review.` and support reference. |
| Operator review | Conflict/terminal state | Player sees safe wait state; support/admin sees detail. |
| Reconciled | Retry or support action resolves | Show final status in wallet history. |

## Interaction Primitives

- Tap presets to choose common values.
- Tap custom amount to enter numeric Stars via numeric keyboard.
- Deposit and Cash Out modals close with the round `X` control. Closing does not cancel committed backend work.
- Submit buttons debounce after first tap. Duplicate taps must not create duplicate requests.
- Server rejection always wins over client-side validation.
- Tevi SDK confirmation is external. Client callback is not authoritative for wallet credit.
- Cash Out Receive amount updates as the entered amount changes.
- Menu/Wallet summary must make pending cashout recoverable after modal close or app resume.
- Back/close affordances from Telegram/Tevi shell should leave the game in a recoverable state and never imply payment cancellation after commit.

## Accessibility Floor

Behavioral. Visual contrast lives in DESIGN.md.

- Every amount preset has an accessible label: `Deposit 100 Stars`, `Cash out 200 Stars`.
- Custom amount field announces current validation state and expected unit: `Amount in Stars`.
- Receive field announces as read-only: `You will receive {amount} Stars after fee`.
- CTA disabled state includes reason in nearby text, not color alone.
- Close button label: `Close deposit` or `Close cash out`.
- Pending states use text and live region updates where the platform allows it.
- Minimum touch target: 44px CSS-equivalent inside the H5 surface.
- Focus order: close, title is skipped as static, presets left-to-right/top-to-bottom, custom amount, receive field if present, CTA, status note.
- Motion reduction: modal open/close and success state avoid dramatic animation when reduced motion is active.
- Error copy must not depend on red color; it must include readable text.

## Responsive & Platform

Primary form factor: mobile Mini App in Telegram/Tevi shell.

| Constraint | Behavior |
|---|---|
| Telegram top chrome present | Modals start below chrome; no content hidden behind top safe area. |
| Narrow mobile width | Presets may wrap to two rows; text size stays legible. |
| Short viewport / keyboard open | Custom amount and CTA remain reachable; modal scrolls internally if needed. |
| SDK unavailable | Deposit and Cash Out actions show unavailable states; no silent fallback to local demo money. |
| App background/resume | Refresh wallet and pending request state before allowing new value-bearing actions. |
| Local demo mode | Payment buttons hidden or clearly non-production; no Tevi labels or real Stars state. |

## Inspiration & Anti-patterns

- **Lifted from provided screenshots:** ornate modal shell, preset amounts, custom input, strong gold CTA, close button, dimmed game background, Deposit and Cash Out as sibling surfaces.
- **Lifted from wallet products:** show fee and receive amount before submit; keep pending transactions recoverable.
- **Rejected — automatic per-win cashout:** Tevi team clarified manual cashout by selected amount.
- **Rejected — browser-like payment page:** game-owned steps remain in the game surface; Tevi SDK owns only its confirmation step.
- **Rejected — client callback as credit proof:** webhook/backend state is authoritative.
- **Rejected — hidden fee:** fee must be visible before cashout submit.

## Key Flows

### Flow 1 — Deposit Stars before playing (Lina, first-time Tevi player, on phone)

1. Lina opens the Hi-Lo Mini App inside Telegram.
2. Game HUD loads with Stars balance `0` and Deposit button visible.
3. She taps Deposit.
4. Deposit modal opens with presets and custom amount field.
5. Lina taps `500`; custom field fills with `500` and `DEPOSIT NOW` enables.
6. She taps `DEPOSIT NOW`.
7. Backend issues deposit token; Tevi SDK confirmation opens.
8. Lina confirms in Tevi.
9. Game returns to webhook pending state.
10. Webhook credits wallet.
11. **Climax:** HUD balance updates to `500 Stars`; Lina can now spin, and the deposit receipt status is visible.

Failure: Lina cancels Tevi confirmation → Deposit modal returns with `Deposit canceled.` and wallet remains unchanged.

### Flow 2 — Cash out selected amount after play (Lina, after winning a few rounds)

1. Lina has `1,240 Stars` available in the game wallet.
2. She opens Cash Out from wallet/menu.
3. Cash Out modal opens with presets, custom amount, Receive field, and fee note.
4. She taps `1000`.
5. Receive field calculates `990` Stars after 1% fee. [ASSUMPTION]
6. She taps `CASH OUT NOW`.
7. Backend validates available balance, limits, compliance, self-exclusion, host float, and Tevi readiness.
8. Internal cashout request commits and wallet available balance updates.
9. Provider dispatch begins after commit.
10. **Climax:** Lina sees `Cash out request received` with reference ID and can return to the game knowing the payout is trackable.

Failure: Lina enters `2000` while only `1,240` is available → inline error says `This amount is higher than your available Stars.` CTA remains disabled.

### Flow 3 — Cashout provider failure is recoverable (Mara, support operator reviewing a player report)

1. A player reports a cashout still pending.
2. Mara searches support/admin by cashout request ID.
3. She sees internal wallet debit/reservation, provider dispatch attempts, current status `failed_retryable`, and safe provider response summary.
4. She retries with the original idempotency key.
5. Provider succeeds or returns already-processed result.
6. **Climax:** The request changes to `reconciled`, the player receipt state updates, and no duplicate payout occurs.

Failure: Provider returns terminal failure → status becomes `operator review`; player sees safe wait copy, and support follows compensating-action policy.

### Flow 4 — Blocked value-bearing action (Noor, self-excluded player)

1. Noor opens the game and authenticates.
2. Backend identifies active self-exclusion.
3. Deposit and Cash Out remain visible enough to explain unavailability, but actions are blocked.
4. Noor taps Deposit.
5. Modal or blocking state explains `Value-bearing play is unavailable for this account.`
6. **Climax:** No deposit token, spin, cashout request, wallet mutation, or Tevi provider call is created.

## Check Round Expectations

Every implementation story touching Deposit or Cash Out must include manual verification evidence:

| Area | Required Check Round evidence |
|---|---|
| Deposit UI | Screenshot/manual observation of presets, custom amount, pending, canceled, credited, failed states |
| Deposit backend | Curl for top-up signature, log request ID, database top-up issuance/idempotency rows |
| Webhook credit | Replay webhook proof, wallet ledger proof, no double-credit |
| Cash Out UI | Screenshot/manual observation of presets, custom amount, receive amount, fee note, disabled/blocked states |
| Cash Out backend | Curl for `POST /api/v1/payments/cashout-requests`, SQL for cashout request and wallet transaction/reservation |
| Cashout idempotency | Retry with same idempotency key returns same result; changed payload conflicts without mutation |
| Reconciliation | Simulated provider timeout/failure, retry command, final state proof |
| Compliance/limits | Deposit and cashout blocked states with no wallet/provider mutation |
| Tevi unavailable | SDK/backend unavailable states; no local-money fallback |

## Open Questions

1. What are the final deposit min, max, and preset values per environment?
2. What are the final cashout min, max, and preset values per environment?
3. Is the 1% withdrawal fee fixed, configurable, or Tevi-provided?
4. Should the Receive amount round down, round nearest, or preserve minor-unit precision?
5. Where exactly should the Cash Out entry point live: wallet summary only, Menu, HUD, or multiple surfaces?
6. What support copy is approved for self-exclusion, KYC, jurisdiction, and production approval blocks?
7. Should a pending cashout reduce visible available balance immediately or show available/reserved split?

---
baseline_commit: b54c990
---

# Story 2.3: Implement Backend Wallet and Balance Transactions

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created -->

## Story

As a player,
I want my balance to be backend-owned,
so that displayed rewards and spend cannot be forged by the client.

## Acceptance Criteria

1. Given a player with an internal point balance, when debits, credits, free-spin awards, jackpot awards, or adjustments are applied, then the backend records balance before, balance after, transaction type, actor/source, and timestamp.
2. All balance values are stored as integer units.
3. Client-provided balance values are ignored.
4. Insufficient balance is rejected without mutating balance or appending a transaction.
5. Money math goes through a single transactional path.
6. Negative balances are impossible through explicit guard logic.
7. A mid-flight failure leaves balance unchanged.
8. Concurrent debits on the same wallet cannot overdraw the wallet.
9. Tests cover debit, credit, insufficient balance, transaction record creation, mid-flight rollback, and concurrent debits.

## Tasks / Subtasks

- [x] Add wallet domain model and public service contract (AC: 1-8)
  - [x] Define wallet transaction types for debit, credit, free-spin award, jackpot award, and adjustment.
  - [x] Define transaction records with balance before/after, actor/source, timestamp, and integer amount units.
  - [x] Document service request/response/error contract in Dev Notes.
- [x] Implement a single transactional wallet mutation path (AC: 1-8)
  - [x] Add `WalletService.applyTransaction` as the only balance mutation path.
  - [x] Add explicit negative-balance guard before commit.
  - [x] Add rollback behavior for injected mid-flight failures.
  - [x] Serialize mutations per wallet so concurrent debits cannot overdraw.
- [x] Add wallet query behavior for future API integration (AC: 1-4)
  - [x] Create or look up player wallets in memory for this sprint slice.
  - [x] Return balance and append-only transaction history from backend state only.
- [x] Add tests for wallet correctness and review gates (AC: 1-9)
  - [x] Test debit and transaction record creation.
  - [x] Test credit.
  - [x] Test insufficient balance with no mutation.
  - [x] Test client-provided balance fields do not influence backend balance.
  - [x] Test mid-flight failure leaves balance unchanged and no transaction appended.
  - [x] Test concurrent debits on the same wallet cannot overdraw.
  - [x] Ensure tests run through root `npm test`.

## Dev Notes

### Business and Epic Context

- Story 2.3 creates backend-owned wallet behavior required by the authoritative spin endpoint in Story 2.4.
- This story remains in-memory because database migrations/persistence are outside this slice, but its service API must mirror a future repository-backed transaction boundary.

### Architecture Guardrails

- Use `apps/api/src/domain/wallet-service.ts` for wallet logic.
- Keep all money-like values as integer point units; do not use JavaScript floats for balances.
- No client-provided balance, payout, RNG seed, or win result is trusted.
- Preserve append-only transaction history and audit fields.
- All balance mutations must go through one service method so later spin ledger and database transaction behavior has one integration point.

### Public Service Contract

`WalletService.applyTransaction(request)`

- Request:

```json
{
  "playerId": "player_1",
  "type": "debit",
  "amount": 100,
  "actor": "spin-service",
  "source": "spin:sess_1",
  "metadata": {}
}
```

- Success:

```json
{
  "wallet": { "playerId": "player_1", "balance": 900 },
  "transaction": {
    "transactionId": "txn_...",
    "playerId": "player_1",
    "type": "debit",
    "amount": 100,
    "balanceBefore": 1000,
    "balanceAfter": 900,
    "actor": "spin-service",
    "source": "spin:sess_1",
    "createdAt": "ISO-8601",
    "metadata": {}
  }
}
```

- Error `INSUFFICIENT_BALANCE`: debit would make balance negative.
- Error `INVALID_TRANSACTION_AMOUNT`: amount is not a positive safe integer.
- Error `INVALID_BALANCE_RESULT`: transaction would produce an unsafe integer balance.
- Error `WALLET_TRANSACTION_FAILED`: a transactional commit hook fails; balance and history roll back.

Test-only constructor hooks may inject a commit failure after balance mutation to prove rollback behavior. The hook is intentionally not part of the public transaction request contract.

### Story-Specific Assumptions

- In-memory wallets start with `1000` integer points to match Story 2.2 session metadata.
- Free-spin awards and jackpot awards are modeled as credit-like positive wallet transactions in this story. Free-spin state can become richer in later stories.
- The in-memory implementation uses per-player promise queues as the concurrency guard. A database-backed implementation should replace this with row locks or serializable transactions.
- Client payloads may contain balance-looking fields in later route integration, but this service ignores unknown fields and only trusts `playerId`, `type`, `amount`, `actor`, `source`, and backend metadata.

### Testing Requirements

- Tests must run under root `npm test`.
- Required coverage: debit, credit, free-spin award, jackpot award, adjustment, insufficient balance, unsafe balance result, transaction record creation, rollback on mid-flight failure, concurrent same-wallet debits, and ignored client-provided balance.
- Tests should use an injected clock so transaction timestamps are deterministic.

### Previous Story Intelligence

- Story 2.2 created provider-neutral player IDs, session IDs, and backend-owned starter balance metadata.
- Keep wallet behavior independent from sessions for this story, but use the same integer starter balance value.

### References

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/2-2-create-session-and-player-identity-adapter.md`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run lint && npm run typecheck && npm test && npm run build`

### Completion Notes List

- Added `WalletService.applyTransaction` as the single mutation path for debit, credit, free-spin award, jackpot award, and adjustment transactions.
- Added backend-owned in-memory wallets with integer point balances, append-only transaction records, deterministic timestamps, and no client balance trust.
- Added explicit insufficient-balance and invalid-amount guards before commit.
- Added unsafe-result guard so credit-like transactions cannot store balances outside JavaScript safe integer precision.
- Added rollback behavior for injected mid-flight failures and per-player mutation queues to serialize concurrent debits.
- Added wallet tests for debit, credit, free-spin award, jackpot award, adjustment, insufficient balance, unsafe balance result, transaction record creation, ignored client balance metadata, mid-flight rollback, and concurrent same-wallet debits.
- Verified `npm run lint && npm run typecheck && npm test && npm run build`.
- Final focused re-review returned no findings after coverage, public contract, and unsafe-balance fixes.
- Re-verified `npm test && npm run build` before marking done.

### File List

- `_bmad-output/implementation-artifacts/2-3-implement-backend-wallet-and-balance-transactions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/domain/wallet-service.ts`
- `apps/api/test/unit/wallet-service.test.ts`

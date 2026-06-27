---
title: Sprint Change Proposal - Manual Tevi Cashout Flow
date: 2026-06-27
project: China Slot Game
status: approved
changeTrigger: Tevi team clarified deposit-play-manual-cashout flow
mode: incremental
scopeClassification: moderate
artifactsModified:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
artifactsPreserved:
  - Completed Epics 1-7
---

# Sprint Change Proposal: Manual Tevi Cashout Flow

## 1. Issue Summary

The Tevi team clarified that players should deposit Stars into the game wallet first, play the slot using that internal Stars balance, and manually cash out by entering an amount in a Cash Out UI. This replaces the prior planning assumption that every winning spin immediately dispatches a Tevi Stars cashout from the host account.

Evidence:

- User-provided Tevi team clarification.
- Screenshot showing a player-facing `CASH OUT` modal with amount selection.
- Existing Tevi PRD addendum and epics previously described automatic per-winning-spin cashout.

Problem statement:

The current Tevi plan incorrectly binds cashout timing to each winning spin. The required product flow is user-initiated manual cashout from available internal Stars balance. The planning artifacts must separate internal win crediting from external Tevi cashout dispatch.

## 2. Impact Analysis

### Epic Impact

- Epic 8 remains the correct sandbox MVP epic, but its cashout path changes from automatic per-win dispatch to manual cashout request and dispatch.
- Epic 9 remains the production gate epic. Its security, observability, compliance, and float controls now apply to manual cashout requests as well as deposits and spins.
- Epic 10 remains the polish and tuning epic. Its UX, receipt, payout status, and analytics stories now need manual cashout states and metrics.
- Epics 1-7 remain done and are preserved.

### Story Impact

Updated stories:

- Story 8.7 now credits wins to internal Stars wallet and returns updated withdrawable balance rather than a cashout-pending indicator.
- Story 8.8 is renamed from `Dispatch Per-Win Tevi Stars Cashout` to `Request Manual Tevi Stars Cashout`.
- Story 8.9 reconciles manual cashout request failures.
- Story 8.10 sends top-up and manual cashout receipts.
- Story 8.11 verifies manual cashout amount entry and idempotency in the sandbox money-path Check Rounds.
- Epic 9 and Epic 10 references now cover manual cashout request observability, analytics, security, and UX.

### Artifact Conflicts

Resolved conflicts:

- Tevi PRD addendum no longer states that every winning spin triggers immediate cashout.
- Architecture no longer defines per-win cashout as part of the spin transaction path.
- Epics no longer contain old per-win cashout story wording.
- Sprint status keys now match renamed manual-cashout story headings.

### Technical Impact

Implementation must add a game-owned manual cashout request boundary before calling Tevi `POST /api/v1/payments/cashout`.

The manual cashout flow requires:

- Player-entered amount validation.
- Available internal Stars balance check.
- Compliance, self-exclusion, cashout-limit, host-float, and Tevi-readiness checks.
- Durable cashout request record.
- Wallet debit or reservation before provider dispatch.
- Provider dispatch after internal transaction commit.
- Retry-safe idempotency key derived from cashout request ID.
- Reconciliation for provider failure or uncertainty.

## 3. Recommended Approach

Selected approach: Direct Adjustment with moderate backlog impact.

Rationale:

- The product goal remains the same: Tevi Stars wallet integration with server-authoritative gameplay.
- The change does not invalidate Epics 1-7 or the deposit/top-up path.
- The change is significant enough to update PRD, architecture, epics, and sprint status before story creation.
- No rollback is needed because Epic 8 implementation has not started.
- No MVP reduction is needed; the manual cashout flow replaces the automatic cashout assumption.

Effort estimate: Medium.

Risk level: Medium, because manual cashout adds user-entered amount validation, wallet reservation/debit semantics, and more explicit payout UX states.

## 4. Detailed Change Proposals

### PRD Addendum Changes

Affected artifact: `_bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md`

Old model:

```markdown
For every winning spin, the backend must dispatch a Tevi Stars cashout after the internal spin transaction commits.
```

New model:

```markdown
The backend must accept authenticated manual cashout requests for player-entered Star amounts and dispatch Tevi Stars cashout only after the internal cashout transaction commits.
```

Rationale: Tevi requires a player-facing Cash Out flow where the user selects an amount. Wins credit the internal wallet; cashout is a separate user action.

### Architecture Changes

Affected artifact: `_bmad-output/planning-artifacts/architecture.md`

Old boundary:

```markdown
CashoutDispatcher: dispatches per-win cashout after the internal spin transaction commits.
```

New boundary:

```markdown
CashoutRequestService validates authenticated manual cashout requests for player-entered Star amounts.
CashoutDispatcher dispatches accepted manual cashout requests after the internal cashout transaction commits.
```

Rationale: The spin transaction must not call Tevi cashout. Manual cashout is its own request, transaction, dispatch, and reconciliation path.

### Epic And Story Changes

Affected artifact: `_bmad-output/planning-artifacts/epics.md`

Old story:

```markdown
### Story 8.8: Dispatch Per-Win Tevi Stars Cashout
```

New story:

```markdown
### Story 8.8: Request Manual Tevi Stars Cashout
```

Rationale: Implementation must build the player-facing amount-entry cashout request first, then provider dispatch/reconciliation.

### Sprint Status Changes

Affected artifact: `_bmad-output/implementation-artifacts/sprint-status.yaml`

Old key:

```yaml
8-8-dispatch-per-win-tevi-stars-cashout: backlog
```

New key:

```yaml
8-8-request-manual-tevi-stars-cashout: backlog
```

Also renamed Story 8.10 key from win receipts to cashout receipts.

## 5. Checklist Status

### Section 1: Understand Trigger and Context

- [x] 1.1 Triggering story identified: N/A. The trigger came from Tevi team clarification before Epic 8 implementation began.
- [x] 1.2 Core problem defined: stakeholder clarification/new requirement. Manual user-entered cashout replaces automatic per-win cashout.
- [x] 1.3 Evidence gathered: Tevi team clarification and screenshot showing Cash Out amount UI.

### Section 2: Epic Impact Assessment

- [x] 2.1 Current impacted epic: Epic 8 can still be completed, but Story 8.8 and related cashout stories must change.
- [x] 2.2 Epic-level changes: modify Epic 8 cashout scope, Epic 9 control coverage, and Epic 10 UX/analytics references.
- [x] 2.3 Remaining epics reviewed: Epics 9 and 10 impacted; Epics 1-7 preserved.
- [x] 2.4 Future epic invalidation: none.
- [x] 2.5 Epic order and priority: unchanged.

### Section 3: Artifact Conflict and Impact Analysis

- [x] 3.1 PRD conflicts: Tevi PRD addendum required update from automatic per-win cashout to manual cashout.
- [x] 3.2 Architecture conflicts: Tevi boundary required new `CashoutRequestService` and manual cashout endpoint.
- [x] 3.3 UI/UX conflicts: UX state inventory required cashout amount entry and insufficient cashout balance states.
- [x] 3.4 Other artifacts: `sprint-status.yaml` required renamed story keys.

### Section 4: Path Forward Evaluation

- [x] 4.1 Direct Adjustment: viable; selected.
- [N/A] 4.2 Potential Rollback: not needed; Epic 8 implementation has not started.
- [N/A] 4.3 PRD MVP Review: not needed; MVP remains achievable with revised cashout model.
- [x] 4.4 Recommended path: direct adjustment with medium effort and medium risk.

### Section 5: Sprint Change Proposal Components

- [x] 5.1 Issue summary created.
- [x] 5.2 Epic impact and artifact needs documented.
- [x] 5.3 Recommended path documented.
- [x] 5.4 MVP impact documented: no reduction; cashout flow model changes.
- [x] 5.5 Handoff plan documented.

### Section 6: Final Review and Handoff

- [x] 6.1 Checklist completion reviewed.
- [x] 6.2 Proposal accuracy reviewed.
- [x] 6.3 User approval obtained: Donnie approved the proposal for implementation handoff on 2026-06-27.
- [x] 6.4 `sprint-status.yaml` updated for renamed stories.
- [x] 6.5 Next steps and handoff plan documented.

## 6. Implementation Handoff

Change scope classification: Moderate.

Route to: Product Owner / Developer agents.

Artifacts updated:

- Tevi PRD addendum.
- Architecture Tevi Readiness Boundary.
- Epic 8-10 planning in `epics.md`.
- Sprint status tracking in `sprint-status.yaml`.

Success criteria:

- No old automatic per-win cashout language remains in PRD, architecture, or epics.
- Story 8.8 is manual cashout request flow.
- Manual cashout endpoint and service boundary exist in planning artifacts.
- Sprint status keys match edited epics.
- Epics 1-7 remain done.

Recommended next step after approval: rerun `bmad-check-implementation-readiness`, then rerun `bmad-sprint-planning` if readiness recommends it.

---
title: Sprint Change Proposal - Tevi Epic 8-10 Readiness Corrections
date: 2026-06-27
project: China Slot Game
status: approved
changeTrigger: implementation-readiness-report-2026-06-27
mode: incremental
scopeClassification: minor
artifactsModified:
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
artifactsPreserved:
  - Completed Epics 1-7
---

# Sprint Change Proposal: Tevi Epic 8-10 Readiness Corrections

## 1. Issue Summary

The implementation readiness assessment dated 2026-06-27 found that the Tevi Mini App Integration PRD addendum, updated architecture Tevi Readiness Boundary, and completed Epic 8-10 planning cover all top-level Tevi functional requirements. The issue is planning execution quality, not missing scope.

The readiness report identified five corrections needed before Epic 8 implementation begins:

1. Add explicit per-story Check Round acceptance criteria to affected Epic 9 and Epic 10 stories.
2. Normalize the Tevi webhook route across PRD, architecture, and epics.
3. Clarify production gate state ownership in Story 9.1.
4. Add a Tevi UX state inventory because no standalone UX document exists.
5. Normalize Tevi requirement IDs in `epics.md` to match the PRD addendum style.

Evidence:

- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-27.md` marked overall readiness as `NEEDS WORK before Epic 8 implementation begins`.
- The report found 100% top-level FR coverage but flagged verification, endpoint consistency, production gate modeling, UX documentation, and traceability cleanup.
- The Tevi PRD addendum requires every epic/story to end with Check Round acceptance criteria using the mandatory verification format.

## 2. Impact Analysis

### Epic Impact

- Epic 8 remains implementation-ready after route normalization and ID normalization.
- Epic 9 remains viable but needed stronger per-story verification and a clear production gate state model owner.
- Epic 10 remains viable but needed per-story Check Round exits for polish, receipt, analytics, payout-state, and tuning stories.
- Completed Epics 1-7 are preserved and not replanned.

### Story Impact

Stories directly corrected:

- Story 8.6: canonical Tevi webhook route changed to `POST /api/v1/webhooks/tevi`.
- Story 9.1: production gate state model ownership added.
- Stories 9.1, 9.2, 9.3, 9.5, 9.6: explicit Check Round exits added.
- Stories 10.1, 10.2, 10.3, 10.4, 10.5: explicit Check Round exits added.

No stories were added, removed, or renumbered.

### Artifact Conflicts

- PRD endpoint inventory already used `POST /api/v1/webhooks/tevi`.
- Architecture and Story 8.6 used `POST /api/webhooks/tevi`; both were updated to match the PRD route.
- `epics.md` used compact Tevi IDs such as `TEVI-FR1`; these were normalized to PRD-style IDs such as `TEVI-FR-1`.

### Technical Impact

No code, database schema, deployment, or runtime implementation changes are introduced by this proposal. The changes affect planning and implementation handoff only.

## 3. Recommended Approach

Selected approach: Direct Adjustment.

Rationale:

- The readiness report found no missing top-level functional requirements.
- The defects are localized to planning clarity and verification discipline.
- No rollback is needed because completed Epics 1-7 remain valid and traceable.
- No PRD MVP review is needed because the Tevi scope remains intact and already phase-gated.

Effort estimate: Low.

Risk level: Low after the corrections, because implementation agents now receive clearer Check Round exits, canonical route naming, shared gate state ownership, UX state expectations, and normalized requirement IDs.

## 4. Detailed Change Proposals

### Proposal 1: Add Epic 9 and Epic 10 Per-Story Check Rounds

Affected artifact: `_bmad-output/planning-artifacts/epics.md`

Old pattern:

```markdown
**And** tests cover blocked and allowed users for each eligibility gate.
```

New pattern:

```markdown
**And** tests cover blocked and allowed users for each eligibility gate
**And** the story ends with a Check Round covering changed files, exact commands, allowed/blocked curl examples, UI/manual blocked-state observations, logs/support-search checks, pass/fail criteria, and gate-denial proof.
```

Rationale: Tevi Stars are treated as real-money-style value. Automated tests alone are not enough; each story needs a human-verifiable stop point before the next story proceeds.

### Proposal 2: Normalize Tevi Webhook Route

Affected artifacts:

- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/epics.md`

Old text:

```markdown
POST /api/webhooks/tevi
```

New text:

```markdown
POST /api/v1/webhooks/tevi
```

Rationale: The PRD endpoint inventory uses the versioned route. Tevi app registration, webhook verification, curl examples, tests, and Check Rounds should target one canonical endpoint.

### Proposal 3: Clarify Production Gate State Ownership

Affected artifact: `_bmad-output/planning-artifacts/epics.md`

Story: 9.1, `Fail Safe Tevi Production Startup Until Required Gates Pass`

New acceptance criteria added:

```markdown
**And** Story 9.1 establishes the shared production gate state model for later Epic 9 stories, including approval records, compliance gate records, deposit-limit settings, self-exclusion records, host-float settings, readiness gate status, actor, reason, timestamp, and request ID
**And** production gate state is persisted in PostgreSQL or equivalent durable storage and is searchable through authorized support/admin workflows without direct database access
**And** later Epic 9 stories consume this shared gate state model rather than creating parallel approval, compliance, deposit-limit, self-exclusion, or float records
```

Rationale: Stories 9.1, 9.2, 9.3, 9.4, and 9.7 all depend on shared production gate state. Story 9.1 now owns the state model so later stories do not invent parallel records.

### Proposal 4: Add Tevi UX State Inventory

Affected artifact: `_bmad-output/planning-artifacts/epics.md`

New section added after `UX-DR13`:

```markdown
### Tevi UX State Inventory
```

The inventory covers launch, identity, top-up, wallet/spin, cashout, receipt, compliance/responsible-value, and host-float/economy states.

Rationale: No standalone UX document exists. The inventory gives implementation stories and Check Rounds a shared baseline for expected visible states and terminology.

### Proposal 5: Normalize Tevi Requirement IDs

Affected artifact: `_bmad-output/planning-artifacts/epics.md`

Old style:

```markdown
TEVI-FR1
```

New style:

```markdown
TEVI-FR-1
```

Rationale: The PRD addendum uses hyphenated IDs. Normalizing `epics.md` avoids false traceability failures in readiness checks and future automation.

## 5. Checklist Status

### Section 1: Understand Trigger and Context

- [x] 1.1 Triggering story identified: N/A. The trigger is the readiness report, not implementation of a single story.
- [x] 1.2 Core problem defined: planning execution-quality defects discovered during readiness validation.
- [x] 1.3 Supporting evidence gathered: readiness report, PRD addendum, architecture, and epics reviewed.

### Section 2: Epic Impact Assessment

- [x] 2.1 Current impacted epic assessment: Epic 8 can proceed after route/ID normalization.
- [x] 2.2 Epic-level changes: no new epic; direct edits to Epic 8-10 planning.
- [x] 2.3 Remaining epics reviewed: Epics 9 and 10 needed verification tightening; Epics 1-7 preserved.
- [x] 2.4 Future epic invalidation: none.
- [x] 2.5 Epic order and priority: unchanged.

### Section 3: Artifact Conflict and Impact Analysis

- [x] 3.1 PRD conflicts: none; PRD remains source of truth for route and Check Round policy.
- [x] 3.2 Architecture conflicts: webhook route normalized.
- [x] 3.3 UX conflicts: no standalone UX doc; state inventory added to epics.
- [x] 3.4 Other artifacts: no sprint-status update because no sprint plan file exists and no stories were added/removed/renumbered.

### Section 4: Path Forward Evaluation

- [x] 4.1 Direct Adjustment: viable; selected.
- [N/A] 4.2 Potential Rollback: not needed.
- [N/A] 4.3 PRD MVP Review: not needed.
- [x] 4.4 Recommended path: direct adjustment with low effort and low risk.

### Section 5: Sprint Change Proposal Components

- [x] 5.1 Issue summary created.
- [x] 5.2 Epic impact and artifact adjustment needs documented.
- [x] 5.3 Recommended path and rationale documented.
- [x] 5.4 MVP impact: no MVP scope reduction; implementation handoff strengthened.
- [x] 5.5 Agent handoff plan documented.

### Section 6: Final Review and Handoff

- [x] 6.1 Checklist completion reviewed.
- [x] 6.2 Proposal accuracy reviewed.
- [x] 6.3 User approval obtained: Donnie approved the proposal for implementation handoff on 2026-06-27.
- [N/A] 6.4 `sprint-status.yaml` update: file not present; no story IDs changed.
- [x] 6.5 Next steps and handoff plan documented.

## 6. Implementation Handoff

Change scope classification: Minor.

Route to: Developer agent / planning maintainer for direct implementation follow-up.

Completed corrections:

- Patched `architecture.md` and `epics.md` route naming.
- Patched `epics.md` with Tevi UX state inventory.
- Patched `epics.md` with Story 9.1 gate-state ownership.
- Patched `epics.md` with missing Epic 9 and Epic 10 Check Round exits.
- Patched `epics.md` with normalized Tevi FR IDs.

Success criteria:

- No compact `TEVI-FR#` IDs remain in `epics.md`.
- PRD, architecture, and epics all use `POST /api/v1/webhooks/tevi`.
- Stories 9.1, 9.2, 9.3, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, and 10.5 end with Check Round criteria.
- Story 9.1 owns the production gate state model.
- Tevi UX state inventory exists in `epics.md`.

Recommended next step: rerun `bmad-check-implementation-readiness` against the corrected Tevi PRD addendum, architecture, and epics.
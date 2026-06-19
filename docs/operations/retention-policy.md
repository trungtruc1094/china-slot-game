# Launch Retention Policy

Date: 2026-06-19

Destructive retention is disabled for launch. Archive/delete execution requires Donnie/legal approval after jurisdiction, tax, dispute, age/identity, and no-purchase/free-entry requirements are confirmed.

| Data type | Retention | Launch policy |
| --- | ---: | --- |
| Spins | 2,555 days | Preserve for dispute, math, and compliance reconstruction. |
| Balance transactions | 2,555 days | Preserve wallet evidence and support reconciliation. |
| Unified audit events | Preserve forever | Canonical operational audit trail. |
| Sessions | 90 days | Minimize identity-adjacent operational data. |
| Configuration history | Preserve forever | Required to reconstruct math, limits, and active versions. |
| Simulation runs | 2,555 days | Preserve RTP/math evidence for activated configurations. |
| Alerts | 730 days | Preserve incident and budget-protection history. |
| Metrics/request traces | 90 days | Operational diagnostics only; no sensitive payloads. |

## Scheduled Job Scaffold

`apps/api/src/jobs/retention-job.ts` is intentionally disabled. It carries a dated TODO and must not delete or archive production data until policy approval is complete.

## Regulatory Constraints

The MVP remains non-cash. Cash-equivalent, redeemable, crypto, or gambling-like rewards require legal review before policy changes. Audit, spin, transaction, configuration, and simulation records may become launch evidence and should not be destructively removed without written approval.

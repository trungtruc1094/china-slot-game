import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const checklist = readFileSync(resolve(repoRoot, "docs/operations/launch-readiness-checklist.md"), "utf8");

describe("launch readiness checklist", () => {
  it("covers every epic with concrete commit, file, and test evidence", () => {
    for (const epic of ["Epic 1", "Epic 2", "Epic 3", "Epic 4", "Epic 5", "Epic 6"]) {
      expect(checklist).toContain(epic);
    }

    for (const commit of ["a0fd1a9", "c86db8b", "8e4a6a2", "98709c4", "9aa23b1", "e91bb11"]) {
      expect(checklist).toContain(commit);
    }

    expect(checklist).toContain("packages/game-math/test/game-math.test.ts");
    expect(checklist).toContain("apps/api/test/integration/spins-routes.test.ts");
    expect(checklist).toContain("apps/api/test/integration/admin-config-activation-routes.test.ts");
    expect(checklist).toContain("apps/api/test/integration/admin-alerts-routes.test.ts");
    expect(checklist).toContain("apps/api/test/integration/admin-audit-search-routes.test.ts");
    expect(checklist).toContain("apps/api/test/unit/ci-quality-gates.test.ts");
  });

  it("keeps launch blocked until manual review and required guardrails are addressed", () => {
    expect(checklist).toContain("Status: Not launch-ready");
    expect(checklist).toContain("Manual review owner: Donnie");
    expect(checklist).toContain("Production admin identity is not approved");
    expect(checklist).toContain("Player identity source is not approved");
    expect(checklist).toContain("Destructive retention execution is intentionally disabled");
    expect(checklist).toContain("Launch cannot proceed if cash-equivalent rewards are enabled");
  });

  it("includes rollback and production breakage runbook sections", () => {
    expect(checklist).toContain("## Rollback Plan");
    expect(checklist).toContain("## If X Breaks In Prod");
    expect(checklist).toContain("Spins fail or time out");
    expect(checklist).toContain("Wallet balance is wrong");
    expect(checklist).toContain("Cash-equivalent reward appears");
    expect(checklist).toContain("Admin/support access is suspect");
  });
});

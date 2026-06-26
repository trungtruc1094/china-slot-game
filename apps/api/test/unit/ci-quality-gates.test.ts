import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("CI quality gates", () => {
  it("runs lint, typecheck, test, coverage, and build in GitHub Actions", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/quality-gates.yml"), "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("run: npm run lint");
    expect(workflow).toContain("run: npm run typecheck");
    expect(workflow).toContain("run: npm test");
    expect(workflow).toContain("run: npm run test:coverage");
    expect(workflow).toContain("run: npm run build");
  });

  it("documents the launch coverage thresholds", () => {
    const config = readFileSync(resolve(repoRoot, "vitest.config.ts"), "utf8");
    const docs = readFileSync(resolve(repoRoot, "docs/operations/ci-quality-gates.md"), "utf8");

    expect(config).toContain("lines: 80");
    expect(config).toContain("functions: 80");
    expect(config).toContain("branches: 76");
    expect(config).toContain("statements: 80");
    expect(docs).toContain("Coverage thresholds are 80%");
    expect(docs).toContain("branches set to 76%");
  });
});

import { describe, expect, it } from "vitest";
import {
  defaultRetentionPolicy,
  requiredRetentionDataTypes,
  validateRetentionPolicyForLaunch
} from "../../src/domain/retention-policy.js";
import { retentionJob } from "../../src/jobs/retention-job.js";

describe("retention policy", () => {
  it("defines explicit retention rules for every launch data type", () => {
    expect(defaultRetentionPolicy.rules.map((rule) => rule.dataType).sort()).toEqual([...requiredRetentionDataTypes].sort());
    for (const rule of defaultRetentionPolicy.rules) {
      expect(rule.retention).toMatchObject({
        mode: expect.stringMatching(/^(duration|preserve_forever)$/)
      });
      expect(rule.regulatoryConstraint).toEqual(expect.any(String));
      expect(rule.regulatoryConstraint.length).toBeGreaterThan(0);
    }
  });

  it("fails launch readiness when a required retention rule is missing", () => {
    const incompletePolicy = {
      ...defaultRetentionPolicy,
      rules: defaultRetentionPolicy.rules.filter((rule) => rule.dataType !== "audit_events")
    };

    expect(validateRetentionPolicyForLaunch(incompletePolicy)).toEqual({
      ready: false,
      missingDataTypes: ["audit_events"],
      destructiveJobsDisabled: true,
      approvalRequired: true
    });
  });

  it("keeps destructive retention jobs disabled by default", () => {
    expect(defaultRetentionPolicy.destructiveJobs.enabled).toBe(false);
    expect(retentionJob.enabled).toBe(false);
    expect(retentionJob.todo).toContain("2026-06-19");
    expect(validateRetentionPolicyForLaunch(defaultRetentionPolicy)).toMatchObject({
      ready: true,
      destructiveJobsDisabled: true,
      approvalRequired: true
    });
  });
});

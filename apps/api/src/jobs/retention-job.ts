import { defaultRetentionPolicy } from "../domain/retention-policy.js";

export const retentionJob = {
  enabled: defaultRetentionPolicy.destructiveJobs.enabled,
  todo: "TODO(2026-06-19): Implement archive/delete execution only after Donnie/legal approves retention policy and jurisdiction requirements.",
  schedule: "disabled"
};

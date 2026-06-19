export const requiredRetentionDataTypes = [
  "spins",
  "balance_transactions",
  "audit_events",
  "sessions",
  "configuration_history",
  "simulation_runs",
  "alerts",
  "metrics_request_traces"
] as const;

export type RetentionDataType = typeof requiredRetentionDataTypes[number];

export type RetentionRule =
  | { mode: "duration"; days: number }
  | { mode: "preserve_forever"; reason: string };

export interface RetentionPolicyRule {
  dataType: RetentionDataType;
  retention: RetentionRule;
  regulatoryConstraint: string;
}

export interface RetentionPolicy {
  rules: RetentionPolicyRule[];
  destructiveJobs: {
    enabled: boolean;
    approvalRequired: boolean;
    approvalOwner: string;
  };
}

export interface RetentionPolicyValidation {
  ready: boolean;
  missingDataTypes: RetentionDataType[];
  destructiveJobsDisabled: boolean;
  approvalRequired: boolean;
}

export const defaultRetentionPolicy: RetentionPolicy = {
  rules: [
    {
      dataType: "spins",
      retention: { mode: "duration", days: 2555 },
      regulatoryConstraint: "Spin ledger may support disputes, compliance review, and reward-model investigations."
    },
    {
      dataType: "balance_transactions",
      retention: { mode: "duration", days: 2555 },
      regulatoryConstraint: "Wallet transactions may become compliance/tax evidence if reward policy changes."
    },
    {
      dataType: "audit_events",
      retention: { mode: "preserve_forever", reason: "Canonical unified audit trail for operational accountability." },
      regulatoryConstraint: "Admin and system audit events are launch evidence and must not be destructively removed before legal review."
    },
    {
      dataType: "sessions",
      retention: { mode: "duration", days: 90 },
      regulatoryConstraint: "Session records should be minimized while preserving short-term support/debug value."
    },
    {
      dataType: "configuration_history",
      retention: { mode: "preserve_forever", reason: "Immutable configuration history proves which math and limits applied to each spin." },
      regulatoryConstraint: "Configuration versions may be needed for fairness, dispute, and regulator-facing reconstruction."
    },
    {
      dataType: "simulation_runs",
      retention: { mode: "duration", days: 2555 },
      regulatoryConstraint: "Simulation evidence supports RTP/math review for activated configurations."
    },
    {
      dataType: "alerts",
      retention: { mode: "duration", days: 730 },
      regulatoryConstraint: "Alert history supports operational incident review and budget-protection decisions."
    },
    {
      dataType: "metrics_request_traces",
      retention: { mode: "duration", days: 90 },
      regulatoryConstraint: "Request traces and metrics are operational diagnostics and must avoid sensitive identity payloads."
    }
  ],
  destructiveJobs: {
    enabled: false,
    approvalRequired: true,
    approvalOwner: "Donnie/legal"
  }
};

export function validateRetentionPolicyForLaunch(policy: RetentionPolicy): RetentionPolicyValidation {
  const presentDataTypes = new Set(policy.rules.map((rule) => rule.dataType));
  const missingDataTypes = requiredRetentionDataTypes.filter((dataType) => !presentDataTypes.has(dataType));

  return {
    ready: missingDataTypes.length === 0 && policy.destructiveJobs.approvalRequired === true,
    missingDataTypes,
    destructiveJobsDisabled: policy.destructiveJobs.enabled === false,
    approvalRequired: policy.destructiveJobs.approvalRequired
  };
}

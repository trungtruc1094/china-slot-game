import { z } from "zod";

export const alertRuleRequestSchema = z.object({
  id: z.string().trim().min(1).max(128),
  scopeId: z.string().trim().min(1).max(128),
  metric: z.enum(["observedRtpAbove", "observedRtpBelow", "remainingBudgetBelow", "jackpotLiabilityAbove"]),
  threshold: z.number().nonnegative(),
  severity: z.enum(["info", "warning", "critical"]),
  suggestedAction: z.string().trim().min(1).max(500),
  enabled: z.boolean().optional().default(true)
});

export const alertEvaluationRequestSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  scopeId: z.string().trim().min(1).max(128).optional(),
  configVersionId: z.string().trim().min(1).max(128).optional()
});

export const acknowledgeAlertRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

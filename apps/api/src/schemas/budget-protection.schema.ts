import { z } from "zod";

export const applyBudgetProtectionRequestSchema = z.object({
  scopeId: z.string().trim().min(1).max(128),
  action: z.enum(["disablePaidSpins", "lowerMaxBet", "pauseCampaign", "requireHostApproval"]),
  reason: z.string().trim().min(1).max(500),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  metricState: z.record(z.string(), z.unknown()).optional().default({})
}).superRefine((input, context) => {
  if (input.action === "lowerMaxBet") {
    const maxBet = input.parameters.maxBet;
    if (typeof maxBet !== "number" || !Number.isSafeInteger(maxBet) || maxBet <= 0) {
      context.addIssue({
        code: "custom",
        message: "lowerMaxBet requires positive integer parameters.maxBet.",
        path: ["parameters", "maxBet"]
      });
    }
  }
});

export const revertBudgetProtectionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

import { z } from "zod";

const positiveIntegerSchema = z.number().int().positive();
const scopeIdSchema = z.string().trim().min(1).max(128);
const currencySchema = z.string().trim().min(2).max(16).regex(/^[A-Z][A-Z0-9_]*$/);

export const operatorLimitsSchema = z.object({
  currency: currencySchema,
  perSpin: z.object({
    minBet: positiveIntegerSchema,
    maxBet: positiveIntegerSchema,
    maxPayout: positiveIntegerSchema
  }),
  perSession: z.object({
    maxSpins: positiveIntegerSchema,
    maxWager: positiveIntegerSchema
  }),
  perDay: z.object({
    playerMaxWager: positiveIntegerSchema,
    playerMaxReward: positiveIntegerSchema
  }),
  campaign: z.object({
    budget: positiveIntegerSchema,
    jackpotCap: positiveIntegerSchema
  })
}).superRefine((limits, context) => {
  const issues: Array<{ message: string; path: Array<string | number> }> = [];
  if (limits.perSpin.minBet > limits.perSpin.maxBet) {
    issues.push({ message: "minBet must be less than or equal to maxBet.", path: ["perSpin", "minBet"] });
  }
  if (limits.perSpin.maxPayout > limits.campaign.jackpotCap) {
    issues.push({ message: "maxPayout cannot exceed jackpotCap.", path: ["perSpin", "maxPayout"] });
  }
  if (limits.perSpin.maxBet > limits.perSession.maxWager) {
    issues.push({ message: "maxBet cannot exceed per-session maxWager.", path: ["perSpin", "maxBet"] });
  }
  if (limits.perSpin.maxBet > limits.perDay.playerMaxWager) {
    issues.push({ message: "maxBet cannot exceed per-day playerMaxWager.", path: ["perSpin", "maxBet"] });
  }
  if (limits.perSpin.maxBet > limits.campaign.budget) {
    issues.push({ message: "maxBet cannot exceed campaign budget.", path: ["perSpin", "maxBet"] });
  }
  if (limits.perDay.playerMaxReward > limits.campaign.budget) {
    issues.push({ message: "playerMaxReward cannot exceed campaign budget.", path: ["perDay", "playerMaxReward"] });
  }
  if (limits.campaign.jackpotCap > limits.campaign.budget) {
    issues.push({ message: "jackpotCap cannot exceed campaign budget.", path: ["campaign", "jackpotCap"] });
  }

  for (const issue of issues) {
    context.addIssue({ code: "custom", message: issue.message, path: issue.path });
  }
});

export const createOperatorLimitsRequestSchema = z.object({
  scopeId: scopeIdSchema,
  limits: operatorLimitsSchema,
  reason: z.string().trim().min(1).max(500).optional()
});

export const updateOperatorLimitsRequestSchema = z.object({
  limits: operatorLimitsSchema,
  reason: z.string().trim().min(1).max(500).optional()
});

export type CreateOperatorLimitsRequest = z.infer<typeof createOperatorLimitsRequestSchema>;
export type UpdateOperatorLimitsRequest = z.infer<typeof updateOperatorLimitsRequestSchema>;

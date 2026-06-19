import { z } from "zod";

export const validateRewardTypeRequestSchema = z.object({
  rewardType: z.string().trim().min(1).max(64)
}).strip();

export type ValidateRewardTypeRequest = z.infer<typeof validateRewardTypeRequestSchema>;

import { z } from "zod";

export const spinWagerSchema = z.object({
  lineBet: z.number().int().positive(),
  selectedWays: z.number().int().positive(),
  totalWager: z.number().int().positive()
});

export const createSpinRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  wager: spinWagerSchema
}).strip();

export type CreateSpinRequest = z.infer<typeof createSpinRequestSchema>;

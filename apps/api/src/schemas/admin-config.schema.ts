import { z } from "zod";

const symbolIdSchema = z.string().trim().min(1).max(64);
const nonNegativeIntegerSchema = z.number().int().min(0);
const positiveIntegerSchema = z.number().int().positive();
const paylineSymbolSchema = z.union([symbolIdSchema, z.literal("any")]);

const paytableEntrySchema = z.object({
  id: z.string().trim().min(1).max(128),
  symbols: z.tuple([
    paylineSymbolSchema,
    paylineSymbolSchema,
    paylineSymbolSchema,
    paylineSymbolSchema,
    paylineSymbolSchema
  ]),
  pay: nonNegativeIntegerSchema,
  freeSpins: nonNegativeIntegerSchema
});

const reelStripSchema = z.object({
  reelIndex: nonNegativeIntegerSchema,
  visibleRows: positiveIntegerSchema,
  symbols: z.array(symbolIdSchema).min(1)
});

export const gameConfigurationSchema = z.object({
  id: z.string().trim().min(1).max(128),
  versionId: z.string().trim().min(1).max(128),
  symbols: z.array(z.object({
    id: symbolIdSchema,
    useWildSubstitute: z.boolean()
  })).min(1),
  reels: z.array(reelStripSchema).min(1).superRefine((reels, context) => {
    const indexes = new Set<number>();
    for (const [position, reel] of reels.entries()) {
      if (indexes.has(reel.reelIndex)) {
        context.addIssue({
          code: "custom",
          message: "reelIndex values must be unique.",
          path: [position, "reelIndex"]
        });
      }
      indexes.add(reel.reelIndex);
    }
  }),
  waysPolicy: z.object({
    kind: z.literal("ways"),
    reels: positiveIntegerSchema,
    rows: positiveIntegerSchema,
    totalWays: positiveIntegerSchema,
    direction: z.literal("left-to-right")
  }),
  paytable: z.array(paytableEntrySchema).min(1),
  payoutPolicy: z.object({
    useLineBetMultiplier: z.boolean(),
    useLineBetFreeSpinMultiplier: z.boolean()
  }),
  wildRule: z.object({
    enabled: z.boolean(),
    symbolId: symbolIdSchema,
    substitutesFromReelIndex: nonNegativeIntegerSchema
  }),
  scatterRule: z.object({
    enabled: z.boolean(),
    symbolId: symbolIdSchema,
    pays: z.array(z.object({
      count: positiveIntegerSchema,
      pay: nonNegativeIntegerSchema,
      freeSpins: nonNegativeIntegerSchema
    }))
  }),
  jackpotRule: z.object({
    enabled: z.boolean(),
    symbolId: symbolIdSchema,
    requiredVisibleCount: positiveIntegerSchema,
    defaultAmount: nonNegativeIntegerSchema,
    incrementPerSpin: nonNegativeIntegerSchema
  }),
  limits: z.object({
    minBet: positiveIntegerSchema,
    maxBet: positiveIntegerSchema,
    maxSingleSpinPayout: nonNegativeIntegerSchema
  })
}).superRefine((config, context) => {
  if (config.limits.minBet > config.limits.maxBet) {
    context.addIssue({
      code: "custom",
      message: "minBet must be less than or equal to maxBet.",
      path: ["limits", "minBet"]
    });
  }
  if (config.waysPolicy.reels !== config.reels.length) {
    context.addIssue({
      code: "custom",
      message: "waysPolicy.reels must match reels length.",
      path: ["waysPolicy", "reels"]
    });
  }
  if (config.reels.some((reel) => reel.visibleRows !== config.waysPolicy.rows)) {
    context.addIssue({
      code: "custom",
      message: "each reel visibleRows must match waysPolicy.rows.",
      path: ["reels"]
    });
  }
});

export const createDraftConfigRequestSchema = z.object({
  id: z.string().trim().min(1).max(128),
  config: gameConfigurationSchema,
  reason: z.string().trim().min(1).max(500).optional()
});

export const updateDraftConfigRequestSchema = z.object({
  config: gameConfigurationSchema,
  reason: z.string().trim().min(1).max(500).optional()
});

export const attachMathReportRequestSchema = z.object({
  wager: z.object({
    lineBet: positiveIntegerSchema,
    selectedWays: positiveIntegerSchema,
    totalWager: positiveIntegerSchema
  }).optional()
});

export type CreateDraftConfigRequest = z.infer<typeof createDraftConfigRequestSchema>;
export type UpdateDraftConfigRequest = z.infer<typeof updateDraftConfigRequestSchema>;
export type AttachMathReportRequest = z.infer<typeof attachMathReportRequestSchema>;

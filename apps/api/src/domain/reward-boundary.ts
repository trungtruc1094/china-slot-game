export const rewardBoundaryMode = "mvp_non_cash" as const;

export const allowedRewardTypes = ["points", "credits", "community_perk"] as const;
export const deniedRewardTypes = [
  "cash",
  "cash_equivalent",
  "crypto",
  "gift_card",
  "voucher",
  "redeemable_prize",
  "cash_out"
] as const;

export type AllowedRewardType = typeof allowedRewardTypes[number];
export type DeniedRewardType = typeof deniedRewardTypes[number];

export interface RewardBoundaryMetadata {
  rewardModel: RewardModelMetadata;
  allowedRewardTypes: AllowedRewardType[];
  deniedRewardTypes: DeniedRewardType[];
}

export interface RewardModelMetadata {
    mode: typeof rewardBoundaryMode;
    unit: "points";
    displayLabel: "Points";
    cashEquivalent: false;
    redemptionEnabled: false;
    cashOutEnabled: false;
    cryptoEnabled: false;
}

export interface RewardTypeValidation {
  rewardType: string;
  allowed: boolean;
  rewardModel: RewardBoundaryMetadata["rewardModel"];
}

const allowedRewardTypeSet = new Set<string>(allowedRewardTypes);
const deniedRewardTypeSet = new Set<string>(deniedRewardTypes);
const rewardTypeAliases = new Map<string, string>([
  ["cashout", "cash_out"],
  ["cash-out", "cash_out"],
  ["cash out", "cash_out"],
  ["cash_equivalent", "cash_equivalent"],
  ["cash-equivalent", "cash_equivalent"],
  ["cash equivalent", "cash_equivalent"],
  ["gift-card", "gift_card"],
  ["gift card", "gift_card"],
  ["giftcard", "gift_card"],
  ["redeemable-prize", "redeemable_prize"],
  ["redeemable prize", "redeemable_prize"],
  ["redeemable prize reward", "redeemable_prize"],
  ["redeemable_reward", "redeemable_prize"],
  ["redeemable reward", "redeemable_prize"],
  ["bitcoin", "crypto"],
  ["btc", "crypto"],
  ["eth", "crypto"],
  ["ethereum", "crypto"],
  ["usdc", "crypto"],
  ["usdt", "crypto"],
  ["usd", "cash"],
  ["fiat", "cash"],
  ["paypal", "cash_equivalent"]
]);

const rewardBoundaryFlagAliases = new Map<string, string>([
  ["cashEquivalent", "cash_equivalent"],
  ["cash_equivalent", "cash_equivalent"],
  ["cashOutEnabled", "cash_out"],
  ["cash_out_enabled", "cash_out"],
  ["cryptoEnabled", "crypto"],
  ["crypto_enabled", "crypto"],
  ["redemptionEnabled", "redeemable_prize"],
  ["redemption_enabled", "redeemable_prize"],
  ["redeemable", "redeemable_prize"],
  ["complianceApproved", "cash_equivalent"]
]);

const deniedRewardSignals: Array<{ pattern: RegExp; rewardType: string }> = [
  { pattern: /\bcash(_?out)?\b/, rewardType: "cash" },
  { pattern: /\bcash_?equivalent\b/, rewardType: "cash_equivalent" },
  { pattern: /\bgift_?card\b/, rewardType: "gift_card" },
  { pattern: /\bvoucher\b/, rewardType: "voucher" },
  { pattern: /\bredeem/, rewardType: "redeemable_prize" },
  { pattern: /\bcrypto\b|\bbitcoin\b|\bbtc\b|\beth\b|\busdc\b|\busdt\b/, rewardType: "crypto" },
  { pattern: /\busd\b|\bfiat\b|\bpaypal\b/, rewardType: "cash_equivalent" }
];

export function getRewardBoundaryMetadata(): RewardBoundaryMetadata {
  return {
    rewardModel: getRewardModelMetadata(),
    allowedRewardTypes: [...allowedRewardTypes],
    deniedRewardTypes: [...deniedRewardTypes]
  };
}

export function getRewardModelMetadata(): RewardModelMetadata {
  return {
    mode: rewardBoundaryMode,
    unit: "points",
    displayLabel: "Points",
    cashEquivalent: false,
    redemptionEnabled: false,
    cashOutEnabled: false,
    cryptoEnabled: false
  };
}

export function isAllowedRewardType(rewardType: string): boolean {
  return allowedRewardTypeSet.has(normalizeRewardType(rewardType));
}

export function isDeniedRewardType(rewardType: string): boolean {
  return deniedRewardTypeSet.has(normalizeRewardType(rewardType));
}

export function validateAllowedRewardType(rewardType: string): RewardTypeValidation {
  const normalizedRewardType = normalizeRewardType(rewardType);
  return {
    rewardType: normalizedRewardType,
    allowed: isAllowedRewardType(normalizedRewardType),
    rewardModel: getRewardModelMetadata()
  };
}

export function normalizeRewardType(rewardType: string): string {
  const normalizedRewardType = rewardType.trim().toLowerCase();
  const separatorNormalizedRewardType = normalizedRewardType.replace(/[\s-]+/g, "_");
  return rewardTypeAliases.get(normalizedRewardType)
    ?? rewardTypeAliases.get(separatorNormalizedRewardType)
    ?? separatorNormalizedRewardType;
}

export function findDeniedRewardTypeSignal(input: unknown): string | null {
  if (typeof input === "string") {
    const rewardType = normalizeRewardType(input);
    if (deniedRewardTypeSet.has(rewardType)) {
      return rewardType;
    }
    return deniedRewardSignals.find((signal) => signal.pattern.test(rewardType))?.rewardType ?? null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findDeniedRewardTypeSignal(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeRewardType(key);
    const keyAlias = rewardBoundaryFlagAliases.get(key) ?? rewardBoundaryFlagAliases.get(normalizedKey);
    if (keyAlias && value === true) {
      return keyAlias;
    }
    if (deniedRewardTypeSet.has(normalizedKey) && value === true) {
      return normalizedKey;
    }

    if (["rewardType", "rewardMode", "redemptionType", "payoutType"].includes(key)) {
      const found = findDeniedRewardTypeSignal(value);
      if (found) {
        return found;
      }
    }

    if (value && typeof value === "object") {
      const found = findDeniedRewardTypeSignal(value);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

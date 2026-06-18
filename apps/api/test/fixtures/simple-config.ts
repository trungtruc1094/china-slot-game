import type { GameConfiguration } from "@china-slot-game/game-math";

export const simpleConfig: GameConfiguration = {
  id: "simple-config",
  versionId: "simple-config-v1",
  symbols: [
    { id: "A", useWildSubstitute: true },
    { id: "B", useWildSubstitute: true },
    { id: "Scatter", useWildSubstitute: false },
    { id: "Jackpot", useWildSubstitute: false }
  ],
  reels: [
    { reelIndex: 0, visibleRows: 1, symbols: ["A", "B"] },
    { reelIndex: 1, visibleRows: 1, symbols: ["A", "B"] },
    { reelIndex: 2, visibleRows: 1, symbols: ["A", "B"] }
  ],
  waysPolicy: {
    kind: "ways",
    reels: 3,
    rows: 1,
    totalWays: 1,
    direction: "left-to-right"
  },
  paytable: [
    { id: "a-3", symbols: ["A", "A", "A", "any", "any"], pay: 5, freeSpins: 0 }
  ],
  payoutPolicy: {
    useLineBetMultiplier: true,
    useLineBetFreeSpinMultiplier: false
  },
  wildRule: {
    enabled: false,
    symbolId: "Wild",
    substitutesFromReelIndex: 1
  },
  scatterRule: {
    enabled: false,
    symbolId: "Scatter",
    pays: []
  },
  jackpotRule: {
    enabled: false,
    symbolId: "Jackpot",
    requiredVisibleCount: 3,
    defaultAmount: 0,
    incrementPerSpin: 0
  },
  limits: {
    minBet: 1,
    maxBet: 2000,
    maxSingleSpinPayout: 1000
  }
};

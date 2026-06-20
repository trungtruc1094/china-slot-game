import { calculateRtpReport, runSimulation, type GameConfiguration } from "@china-slot-game/game-math";
import type { InMemoryGameConfigurationRepository } from "../domain/game-configuration-repository.js";

const seedDraftId = "seed-fast-realish-94-draft";
const seedActor = "deployment-seed";

export const seededActiveConfig: GameConfiguration = {
  id: "current-client-config",
  versionId: "current-client-config-fast-realish-94-v1",
  symbols: [
    { id: "CoinsHeap", useWildSubstitute: true },
    { id: "Scroll", useWildSubstitute: true },
    { id: "Fan", useWildSubstitute: true },
    { id: "10", useWildSubstitute: true },
    { id: "A", useWildSubstitute: true },
    { id: "Teapot", useWildSubstitute: true },
    { id: "Sycee", useWildSubstitute: true },
    { id: "J", useWildSubstitute: true },
    { id: "K", useWildSubstitute: true },
    { id: "Q", useWildSubstitute: true },
    { id: "Wild", useWildSubstitute: false },
    { id: "Scatter", useWildSubstitute: false },
    { id: "Jackpot", useWildSubstitute: false }
  ],
  reels: [
    { reelIndex: 0, visibleRows: 3, symbols: ["A", "K", "Q", "J", "Fan"] },
    { reelIndex: 1, visibleRows: 3, symbols: ["A", "K", "Q", "CoinsHeap", "Sycee"] },
    { reelIndex: 2, visibleRows: 3, symbols: ["A", "K", "Q", "Teapot", "J"] },
    { reelIndex: 3, visibleRows: 3, symbols: ["A", "K", "Q", "Fan", "Sycee"] },
    { reelIndex: 4, visibleRows: 3, symbols: ["A", "K", "Q", "Teapot", "CoinsHeap"] }
  ],
  waysPolicy: {
    kind: "ways",
    reels: 5,
    rows: 3,
    totalWays: 243,
    direction: "left-to-right"
  },
  paytable: [
    { id: "a-5", symbols: ["A", "A", "A", "A", "A"], pay: 85, freeSpins: 0 },
    { id: "a-4", symbols: ["A", "A", "A", "A", "any"], pay: 52, freeSpins: 0 },
    { id: "a-3", symbols: ["A", "A", "A", "any", "any"], pay: 36, freeSpins: 0 },
    { id: "k-5", symbols: ["K", "K", "K", "K", "K"], pay: 66, freeSpins: 0 },
    { id: "k-4", symbols: ["K", "K", "K", "K", "any"], pay: 46, freeSpins: 0 },
    { id: "k-3", symbols: ["K", "K", "K", "any", "any"], pay: 36, freeSpins: 0 },
    { id: "q-5", symbols: ["Q", "Q", "Q", "Q", "Q"], pay: 63, freeSpins: 0 },
    { id: "q-4", symbols: ["Q", "Q", "Q", "Q", "any"], pay: 43, freeSpins: 0 },
    { id: "q-3", symbols: ["Q", "Q", "Q", "any", "any"], pay: 36, freeSpins: 0 }
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
    requiredVisibleCount: 6,
    defaultAmount: 0,
    incrementPerSpin: 0
  },
  limits: {
    minBet: 1,
    maxBet: 20,
    maxSingleSpinPayout: 1000
  }
};

export function seedActiveConfigForDeployment(repository: InMemoryGameConfigurationRepository): void {
  if (repository.getActiveConfig() || repository.read(seedDraftId)) {
    return;
  }

  repository.createDraft({
    id: seedDraftId,
    config: seededActiveConfig,
    actor: seedActor,
    metadata: { reason: "Seeded fast real-ish 94% RTP config for testing deployment." }
  });

  const wager = { lineBet: 1, selectedWays: 243, totalWager: 243 };
  const report = calculateRtpReport(seededActiveConfig, { wager });
  repository.attachMathReport({
    draftId: seedDraftId,
    report,
    actor: seedActor
  });

  repository.storeSimulationRun({
    draftId: seedDraftId,
    input: {
      spinCount: 1000,
      seed: "deployment-seed-smoke",
      wager,
      theoreticalRtp: report.theoreticalRtp
    },
    result: runSimulation(seededActiveConfig, {
      spinCount: 1000,
      seed: "deployment-seed-smoke",
      wager,
      theoreticalRtp: report.theoreticalRtp
    }),
    actor: seedActor
  });

  repository.activateDraft({
    id: seedDraftId,
    actor: seedActor,
    reason: "Seed active config on startup for testing deployment."
  });

  console.info(`[seed] Active config seeded: ${seededActiveConfig.versionId} rtp=${report.theoreticalRtp}`);
}

import type {
  GameConfiguration,
  IntegerUnit,
  ReelStop,
  RtpCalculationInput,
  SimulationInput,
  SimulationResult,
  VolatilitySummary,
} from './config-types.js';
import { buildVisibleWindow } from './ways.js';
import { calculateWins } from './win-calculator.js';

const DEFAULT_SEED = 'default-simulation-seed';
const DEFAULT_WAGER: RtpCalculationInput = {
  lineBet: 1,
  selectedWays: 243,
  totalWager: 243,
};

export function runSimulation(
  config: GameConfiguration,
  input: SimulationInput,
): SimulationResult {
  validateSimulationInput(config, input);

  const seed = input.seed ?? DEFAULT_SEED;
  const wager = input.wager ?? DEFAULT_WAGER;
  const nextRandom = createSeededRandom(seed);
  const payouts: IntegerUnit[] = [];
  let totalPaid = 0;
  let hitCount = 0;
  let scatterCount = 0;
  let jackpotCount = 0;
  let largestWin = 0;

  for (let spinIndex = 0; spinIndex < input.spinCount; spinIndex++) {
    const reelStops = sampleReelStops(config, nextRandom);
    const visibleWindow = buildVisibleWindow(config, reelStops);
    const winBreakdown = calculateWins(config, visibleWindow);
    const payout = resolveOutcomePay(config, winBreakdown.totalPay, wager);

    payouts.push(payout);
    totalPaid += payout;
    largestWin = Math.max(largestWin, payout);
    if (payout > 0 || winBreakdown.totalFreeSpins > 0) {
      hitCount++;
    }
    if (winBreakdown.scatterWins.length > 0) {
      scatterCount++;
    }
    if (winBreakdown.jackpotWins.length > 0) {
      jackpotCount++;
    }
  }

  const totalWagered = input.spinCount * wager.totalWager;
  const observedRtp = totalPaid / totalWagered;

  return {
    configId: config.id,
    configVersionId: config.versionId,
    spinCount: input.spinCount,
    seed,
    totalWagered,
    totalPaid,
    observedRtp,
    hitRate: hitCount / input.spinCount,
    largestWin,
    scatterCount,
    jackpotCount,
    volatility: summarizeVolatility(payouts, wager),
    confidenceNotes: buildConfidenceNotes(input.spinCount, observedRtp, input.theoreticalRtp),
  };
}

function sampleReelStops(
  config: GameConfiguration,
  nextRandom: () => number,
): ReelStop[] {
  return config.reels.map((reel) => ({
    reelIndex: reel.reelIndex,
    stopIndex: Math.floor(nextRandom() * reel.symbols.length),
  }));
}

function summarizeVolatility(
  payouts: IntegerUnit[],
  wager: RtpCalculationInput,
): VolatilitySummary {
  const meanPayout = payouts.reduce((total, payout) => total + payout, 0) / payouts.length;
  const variance = payouts.reduce((total, payout) => {
    const difference = payout - meanPayout;
    return total + difference * difference;
  }, 0) / payouts.length;

  return {
    meanPayout,
    variance,
    standardDeviation: Math.sqrt(variance),
    zeroPayCount: payouts.filter((payout) => payout === 0).length,
    smallWinCount: payouts.filter((payout) => payout > 0 && payout <= wager.totalWager).length,
    mediumWinCount: payouts.filter(
      (payout) => payout > wager.totalWager && payout <= wager.totalWager * 10,
    ).length,
    largeWinCount: payouts.filter((payout) => payout > wager.totalWager * 10).length,
  };
}

function buildConfidenceNotes(
  spinCount: number,
  observedRtp: number,
  theoreticalRtp: number | undefined,
): SimulationResult['confidenceNotes'] {
  const notes: SimulationResult['confidenceNotes'] = [];
  if (spinCount < 1000) {
    notes.push({
      code: 'LOW_SAMPLE_SIZE',
      severity: 'warning',
      message: 'Simulation uses fewer than 1000 spins; observed RTP may vary substantially.',
    });
  }
  if (theoreticalRtp !== undefined) {
    notes.push({
      code: 'RTP_DELTA',
      severity: Math.abs(observedRtp - theoreticalRtp) > 0.05 ? 'warning' : 'info',
      message: `Observed RTP delta from theoretical RTP is ${observedRtp - theoreticalRtp}.`,
    });
  }
  return notes;
}

function validateSimulationInput(config: GameConfiguration, input: SimulationInput): void {
  validatePositiveInteger('spinCount', input.spinCount);
  const wager = input.wager ?? DEFAULT_WAGER;
  validatePositiveInteger('lineBet', wager.lineBet);
  validatePositiveInteger('selectedWays', wager.selectedWays);
  validatePositiveInteger('totalWager', wager.totalWager);
  if (input.theoreticalRtp !== undefined && !Number.isFinite(input.theoreticalRtp)) {
    throw new Error('theoreticalRtp must be finite when provided.');
  }
  if (config.reels.length === 0) {
    throw new Error('Cannot run simulation for a configuration with no reels.');
  }
  for (const reel of config.reels) {
    if (reel.symbols.length === 0) {
      throw new Error(`Cannot run simulation because reel ${reel.reelIndex} has no symbols.`);
    }
  }
}

function resolveOutcomePay(
  config: GameConfiguration,
  basePay: IntegerUnit,
  wager: RtpCalculationInput,
): IntegerUnit {
  return config.payoutPolicy.useLineBetMultiplier ? basePay * wager.lineBet : basePay;
}

function validatePositiveInteger(label: string, value: IntegerUnit): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

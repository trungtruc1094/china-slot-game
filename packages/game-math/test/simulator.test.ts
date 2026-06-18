import { describe, expect, it } from 'vitest';

import {
  calculateRtpReport,
  runSimulation,
} from '../src/index.js';
import type {
  GameConfiguration,
  PaytableEntry,
  SymbolMetadata,
} from '../src/index.js';

describe('seeded simulation runner', () => {
  it('returns identical aggregate output for the same seed and inputs', () => {
    const input = {
      spinCount: 250,
      seed: 'repeatable-seed',
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
    };

    expect(runSimulation(exactConfig(), input)).toEqual(runSimulation(exactConfig(), input));
  });

  it('allows different seeds to produce different sampled aggregates', () => {
    const baseInput = {
      spinCount: 50,
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
    };

    expect(runSimulation(exactConfig(), { ...baseInput, seed: 'alpha' })).not.toEqual(
      runSimulation(exactConfig(), { ...baseInput, seed: 'bravo' }),
    );
  });

  it('aggregates observed metrics and volatility summary', () => {
    const result = runSimulation(exactConfig(), {
      spinCount: 20,
      seed: 'aggregate-seed',
      wager: { lineBet: 2, selectedWays: 1, totalWager: 2 },
      theoreticalRtp: 54 / 16,
    });

    expect(result).toEqual({
      configId: 'exact-config',
      configVersionId: 'exact-config-v1',
      spinCount: 20,
      seed: 'aggregate-seed',
      totalWagered: 40,
      totalPaid: 142,
      observedRtp: 3.55,
      hitRate: 0.8,
      largestWin: 22,
      scatterCount: 13,
      jackpotCount: 6,
      volatility: {
        meanPayout: 7.1,
        variance: 99.79,
        standardDeviation: 9.989494481704266,
        zeroPayCount: 13,
        smallWinCount: 0,
        mediumWinCount: 1,
        largeWinCount: 6,
      },
      confidenceNotes: [
        {
          code: 'LOW_SAMPLE_SIZE',
          severity: 'warning',
          message: 'Simulation uses fewer than 1000 spins; observed RTP may vary substantially.',
        },
        {
          code: 'RTP_DELTA',
          severity: 'warning',
          message: 'Observed RTP delta from theoretical RTP is 0.17499999999999982.',
        },
      ],
    });
  });

  it('converges near theoretical RTP on a compact fixture', () => {
    const config = exactConfig();
    const wager = { lineBet: 1, selectedWays: 1, totalWager: 1 };
    const theoretical = calculateRtpReport(config, { wager }).theoreticalRtp;
    const result = runSimulation(config, {
      spinCount: 20000,
      seed: 'convergence-seed',
      wager,
      theoreticalRtp: theoretical,
    });

    expect(Math.abs(result.observedRtp - theoretical)).toBeLessThan(0.15);
    expect(result.confidenceNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RTP_DELTA' }),
      ]),
    );
  });

  it('does not report scatter or jackpot counts when those rules are disabled', () => {
    const result = runSimulation(
      {
        ...exactConfig(),
        scatterRule: { enabled: false, symbolId: 'Scatter', pays: [] },
        jackpotRule: {
          enabled: false,
          symbolId: 'Jackpot',
          requiredVisibleCount: 2,
          defaultAmount: 11,
          incrementPerSpin: 1,
        },
      },
      {
        spinCount: 100,
        seed: 'disabled-rules',
        wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      },
    );

    expect(result.scatterCount).toBe(0);
    expect(result.jackpotCount).toBe(0);
  });

  it('returns JSON-serializable simulation output', () => {
    const result = runSimulation(exactConfig(), {
      spinCount: 25,
      seed: 'json-seed',
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
    });
    const roundTripped = JSON.parse(JSON.stringify(result)) as unknown;

    expect(roundTripped).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/Infinity|NaN/);
  });

  it('rejects invalid simulation inputs', () => {
    expect(() => runSimulation(exactConfig(), { spinCount: 0 })).toThrow(
      /spinCount must be a positive safe integer/,
    );
    expect(() =>
      runSimulation(exactConfig(), {
        spinCount: 1,
        wager: { lineBet: 1, selectedWays: 1, totalWager: 0 },
      }),
    ).toThrow(/totalWager must be a positive safe integer/);
    expect(() =>
      runSimulation(
        {
          ...exactConfig(),
          reels: [],
        },
        { spinCount: 1 },
      ),
    ).toThrow(/configuration with no reels/);
    expect(() =>
      runSimulation(
        {
          ...exactConfig(),
          reels: [{ reelIndex: 0, visibleRows: 1, symbols: [] }],
        },
        { spinCount: 1 },
      ),
    ).toThrow(/reel 0 has no symbols/);
  });
});

const baseSymbols: SymbolMetadata[] = [
  { id: 'A', useWildSubstitute: true },
  { id: 'Wild', useWildSubstitute: false },
  { id: 'Scatter', useWildSubstitute: false },
  { id: 'Jackpot', useWildSubstitute: false },
];

function exactConfig(): GameConfiguration {
  return {
    id: 'exact-config',
    versionId: 'exact-config-v1',
    symbols: baseSymbols,
    reels: [
      { reelIndex: 0, visibleRows: 1, symbols: ['A', 'Scatter'] },
      { reelIndex: 1, visibleRows: 1, symbols: ['A', 'Jackpot'] },
      { reelIndex: 2, visibleRows: 1, symbols: ['A', 'Jackpot'] },
    ],
    waysPolicy: {
      kind: 'ways',
      reels: 3,
      rows: 1,
      totalWays: 1,
      direction: 'left-to-right',
    },
    paytable: [payline('a-3', ['A', 'A', 'A', 'any', 'any'], 5)],
    payoutPolicy: {
      useLineBetMultiplier: true,
      useLineBetFreeSpinMultiplier: false,
    },
    wildRule: {
      enabled: true,
      symbolId: 'Wild',
      substitutesFromReelIndex: 1,
    },
    scatterRule: {
      enabled: true,
      symbolId: 'Scatter',
      pays: [{ count: 1, pay: 0, freeSpins: 2 }],
    },
    jackpotRule: {
      enabled: true,
      symbolId: 'Jackpot',
      requiredVisibleCount: 2,
      defaultAmount: 11,
      incrementPerSpin: 1,
    },
    limits: {
      minBet: 1,
      maxBet: 20,
      maxSingleSpinPayout: 1000,
    },
  };
}

function payline(
  id: string,
  symbols: PaytableEntry['symbols'],
  pay: number,
  freeSpins = 0,
): PaytableEntry {
  return {
    id,
    symbols,
    pay,
    freeSpins,
  };
}

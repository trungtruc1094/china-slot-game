import { describe, expect, it } from 'vitest';

import {
  calculateRtpReport,
  findConfigurationDiagnostics,
  generateWays,
  buildVisibleWindow,
} from '../src/index.js';
import { currentClientConfig } from './fixtures/current-client-config.js';
import type {
  GameConfiguration,
  PaytableEntry,
  SymbolMetadata,
} from '../src/index.js';

describe('RTP calculator and configuration diagnostics', () => {
  it('calculates exact theoretical math for a compact deterministic config', () => {
    const report = calculateRtpReport(exactConfig(), {
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
    });

    expect(report.totalOutcomes).toBe(8);
    expect(report.totalWagered).toBe(8);
    expect(report.totalPaid).toBe(27);
    expect(report.theoreticalRtp).toBe(27 / 8);
    expect(report.hitRate).toBe(0.75);
    expect(report.freeSpinTriggerFrequency).toBe(0.5);
    expect(report.jackpotTriggerFrequency).toBe(0.25);
    expect(report.maxPayoutExposure).toBe(11);
    expect(report.payoutDistribution).toEqual([
      { payout: 0, count: 5, probability: 0.625 },
      { payout: 5, count: 1, probability: 0.125 },
      { payout: 11, count: 2, probability: 0.25 },
    ]);
  });

  it('applies configured line bet multiplication to theoretical payouts', () => {
    const report = calculateRtpReport(exactConfig(), {
      wager: { lineBet: 2, selectedWays: 1, totalWager: 2 },
    });

    expect(report.totalOutcomes).toBe(8);
    expect(report.totalWagered).toBe(16);
    expect(report.totalPaid).toBe(54);
    expect(report.theoreticalRtp).toBe(54 / 16);
    expect(report.maxPayoutExposure).toBe(22);
    expect(report.payoutDistribution).toEqual([
      { payout: 0, count: 5, probability: 0.625 },
      { payout: 10, count: 1, probability: 0.125 },
      { payout: 22, count: 2, probability: 0.25 },
    ]);
  });

  it('detects current client config risks and preserves 243 ways per visible window', () => {
    const diagnostics = findConfigurationDiagnostics(currentClientConfig, {
      includeServerExampleMismatchDiagnostic: true,
    });
    const firstWindow = buildVisibleWindow(
      currentClientConfig,
      currentClientConfig.reels.map((reel) => ({ reelIndex: reel.reelIndex, stopIndex: 0 })),
    );

    expect(generateWays(firstWindow)).toHaveLength(243);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNREACHABLE_PAYTABLE_ENTRY',
          path: ['paytable', 'scroll-3'],
        }),
        expect.objectContaining({
          code: 'UNUSED_SYMBOL_METADATA',
          path: ['symbols', '10'],
        }),
        expect.objectContaining({
          code: 'SERVER_EXAMPLE_MISMATCH',
          path: ['server_examples', 'server.js'],
        }),
      ]),
    );
  });

  it('can derive every current client reel stop combination count without mutating config', () => {
    const expectedOutcomes = currentClientConfig.reels.reduce(
      (product, reel) => product * reel.symbols.length,
      1,
    );

    expect(expectedOutcomes).toBe(460800);
    expect(currentClientConfig.reels).toHaveLength(5);
  });

  it('returns JSON-serializable report output', () => {
    const report = calculateRtpReport(exactConfig(), {
      wager: { lineBet: 1, selectedWays: 1, totalWager: 1 },
      includeServerExampleMismatchDiagnostic: true,
    });
    const roundTripped = JSON.parse(JSON.stringify(report)) as unknown;

    expect(roundTripped).toEqual(report);
    expect(JSON.stringify(report)).not.toMatch(/Infinity|NaN/);
  });

  it('reports missing symbols and malformed scatter and jackpot settings', () => {
    const diagnostics = findConfigurationDiagnostics({
      ...exactConfig(),
      symbols: baseSymbols.filter((symbol) => symbol.id !== 'Bonus'),
      paytable: [payline('missing-bonus', ['Bonus', 'Bonus', 'Bonus', 'any', 'any'], 1)],
      scatterRule: {
        enabled: true,
        symbolId: 'MissingScatter',
        pays: [{ count: 0, pay: -1, freeSpins: 1.5 }],
      },
      jackpotRule: {
        enabled: true,
        symbolId: 'MissingJackpot',
        requiredVisibleCount: 0,
        defaultAmount: -1,
        incrementPerSpin: 0.25,
      },
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_SYMBOL_METADATA', path: ['symbols', 'Bonus'] }),
        expect.objectContaining({ code: 'MISSING_SYMBOL_METADATA', path: ['symbols', 'MissingScatter'] }),
        expect.objectContaining({ code: 'MISSING_SYMBOL_METADATA', path: ['symbols', 'MissingJackpot'] }),
        expect.objectContaining({ code: 'INVALID_SCATTER_RULE', path: ['scatterRule', 'pays', '0', 'count'] }),
        expect.objectContaining({ code: 'INVALID_SCATTER_RULE', path: ['scatterRule', 'pays', '0'] }),
        expect.objectContaining({ code: 'INVALID_SCATTER_RULE', path: ['scatterRule', 'symbolId'] }),
        expect.objectContaining({ code: 'INVALID_JACKPOT_RULE', path: ['jackpotRule', 'symbolId'] }),
        expect.objectContaining({ code: 'INVALID_JACKPOT_RULE', path: ['jackpotRule', 'requiredVisibleCount'] }),
        expect.objectContaining({ code: 'INVALID_JACKPOT_RULE', path: ['jackpotRule', 'defaultAmount'] }),
        expect.objectContaining({ code: 'INVALID_JACKPOT_RULE', path: ['jackpotRule', 'incrementPerSpin'] }),
      ]),
    );
  });

  it('rejects invalid wager inputs before calculating reports', () => {
    expect(() =>
      calculateRtpReport(exactConfig(), {
        wager: { lineBet: 1, selectedWays: 1, totalWager: 0 },
      }),
    ).toThrow(/totalWager must be a positive safe integer/);
    expect(() =>
      calculateRtpReport(exactConfig(), {
        wager: { lineBet: 1.25, selectedWays: 1, totalWager: 1 },
      }),
    ).toThrow(/lineBet must be a positive safe integer/);
  });
});

const baseSymbols: SymbolMetadata[] = [
  { id: 'A', useWildSubstitute: true },
  { id: 'Bonus', useWildSubstitute: true },
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

import { describe, expect, it } from 'vitest';

import {
  calculateWins,
  findWinCalculationDiagnostics,
} from '../src/index.js';
import { currentClientConfig } from './fixtures/current-client-config.js';
import type {
  GameConfiguration,
  PaytableEntry,
  ScatterPay,
  SymbolMetadata,
  VisibleWindow,
} from '../src/index.js';

describe('win, scatter, and jackpot calculation', () => {
  it('returns an empty breakdown for a no-win window', () => {
    const breakdown = calculateWins(
      configWith({
        paytable: [payline('fan-3', ['Fan', 'Fan', 'Fan', 'any', 'any'], 2)],
      }),
      windowFromRows([['Fan'], ['Sycee'], ['Fan'], ['CoinsHeap'], ['K']]),
    );

    expect(breakdown).toEqual({
      wayWins: [],
      scatterWins: [],
      jackpotWins: [],
      totalPay: 0,
      totalFreeSpins: 0,
    });
  });

  it('calculates a regular left-to-right ways win', () => {
    const breakdown = calculateWins(
      configWith({
        paytable: [payline('fan-3', ['Fan', 'Fan', 'Fan', 'any', 'any'], 2)],
      }),
      windowFromRows([['Fan'], ['Fan'], ['Fan'], ['CoinsHeap'], ['K']]),
    );

    expect(breakdown.wayWins).toEqual([
      expect.objectContaining({
        id: 'way-0:fan-3',
        symbolId: 'Fan',
        matchedReels: 3,
        pay: 2,
        freeSpins: 0,
        coordinates: [
          { reelIndex: 0, rowIndex: 0 },
          { reelIndex: 1, rowIndex: 0 },
          { reelIndex: 2, rowIndex: 0 },
        ],
      }),
    ]);
    expect(breakdown.totalPay).toBe(2);
    expect(breakdown.totalFreeSpins).toBe(0);
  });

  it('chooses the best matching paytable entry using lowercase pay and freeSpins', () => {
    const breakdown = calculateWins(
      configWith({
        paytable: [
          payline('a-low-order-first', ['A', 'A', 'A', 'any', 'any'], 1, 9),
          payline('a-pay-wins', ['A', 'A', 'A', 'A', 'any'], 5, 0),
          payline('a-free-spin-tiebreak', ['A', 'A', 'A', 'A', 'any'], 5, 4),
        ],
      }),
      windowFromRows([['A'], ['A'], ['A'], ['A'], ['K']]),
    );

    expect(breakdown.wayWins).toHaveLength(1);
    expect(breakdown.wayWins[0]).toMatchObject({
      id: 'way-0:a-free-spin-tiebreak',
      pay: 5,
      freeSpins: 4,
      matchedReels: 4,
    });
    expect(breakdown.totalPay).toBe(5);
    expect(breakdown.totalFreeSpins).toBe(4);
  });

  it('allows configured wild substitution after the first reel', () => {
    const breakdown = calculateWins(
      configWith({
        paytable: [payline('fan-3', ['Fan', 'Fan', 'Fan', 'any', 'any'], 2)],
      }),
      windowFromRows([['Fan'], ['Wild'], ['Fan'], ['CoinsHeap'], ['K']]),
    );

    expect(breakdown.wayWins[0]).toMatchObject({
      id: 'way-0:fan-3',
      symbolId: 'Fan',
      coordinates: [
        { reelIndex: 0, rowIndex: 0 },
        { reelIndex: 1, rowIndex: 0 },
        { reelIndex: 2, rowIndex: 0 },
      ],
    });
  });

  it('does not allow first-reel or non-substitutable wild false wins', () => {
    const firstReelWild = calculateWins(
      configWith({
        paytable: [payline('fan-3', ['Fan', 'Fan', 'Fan', 'any', 'any'], 2)],
      }),
      windowFromRows([['Wild'], ['Fan'], ['Fan'], ['CoinsHeap'], ['K']]),
    );
    const nonSubstitutable = calculateWins(
      configWith({
        symbols: [
          ...baseSymbols,
          { id: 'Bonus', useWildSubstitute: false },
        ],
        paytable: [payline('bonus-3', ['Bonus', 'Bonus', 'Bonus', 'any', 'any'], 99)],
      }),
      windowFromRows([['Bonus'], ['Wild'], ['Bonus'], ['CoinsHeap'], ['K']]),
    );

    expect(firstReelWild.wayWins).toEqual([]);
    expect(nonSubstitutable.wayWins).toEqual([]);
  });

  it('does not allow wilds to substitute for scatter or jackpot paytable targets', () => {
    const scatterTarget = calculateWins(
      configWith({
        paytable: [payline('scatter-3-line', ['Scatter', 'Scatter', 'Scatter', 'any', 'any'], 99)],
      }),
      windowFromRows([['Scatter'], ['Wild'], ['Scatter'], ['Fan'], ['K']]),
    );
    const jackpotTarget = calculateWins(
      configWith({
        paytable: [payline('jackpot-3-line', ['Jackpot', 'Jackpot', 'Jackpot', 'any', 'any'], 99)],
      }),
      windowFromRows([['Jackpot'], ['Wild'], ['Jackpot'], ['Fan'], ['K']]),
    );

    expect(scatterTarget.wayWins).toEqual([]);
    expect(jackpotTarget.wayWins).toEqual([]);
  });

  it('ignores malformed non-prefix paytable entries', () => {
    const breakdown = calculateWins(
      configWith({
        paytable: [
          payline('leading-any', ['any', 'Fan', 'Fan', 'any', 'any'], 99),
          payline('gapped-prefix', ['Fan', 'any', 'Fan', 'any', 'any'], 88),
        ],
      }),
      windowFromRows([['Fan'], ['Fan'], ['Fan'], ['CoinsHeap'], ['K']]),
    );

    expect(breakdown.wayWins).toEqual([]);
    expect(breakdown.totalPay).toBe(0);
  });

  it('calculates scatter free spins and jackpot pay from visible symbols', () => {
    const breakdown = calculateWins(
      configWith({
        paytable: [],
        scatterPays: [{ count: 5, pay: 0, freeSpins: 5 }],
        jackpotRequiredVisibleCount: 6,
      }),
      windowFromRows([
        ['Scatter', 'Jackpot', 'Jackpot'],
        ['Scatter', 'Jackpot', 'Jackpot'],
        ['Scatter', 'Jackpot', 'Jackpot'],
        ['Scatter', 'Fan', 'Fan'],
        ['Scatter', 'K', 'K'],
      ]),
    );

    expect(breakdown.scatterWins).toEqual([
      {
        id: 'scatter-5',
        symbolId: 'Scatter',
        count: 5,
        coordinates: [
          { reelIndex: 0, rowIndex: 0 },
          { reelIndex: 1, rowIndex: 0 },
          { reelIndex: 2, rowIndex: 0 },
          { reelIndex: 3, rowIndex: 0 },
          { reelIndex: 4, rowIndex: 0 },
        ],
        pay: 0,
        freeSpins: 5,
      },
    ]);
    expect(breakdown.jackpotWins).toEqual([
      {
        id: 'jackpot-6',
        symbolId: 'Jackpot',
        count: 6,
        coordinates: [
          { reelIndex: 0, rowIndex: 1 },
          { reelIndex: 0, rowIndex: 2 },
          { reelIndex: 1, rowIndex: 1 },
          { reelIndex: 1, rowIndex: 2 },
          { reelIndex: 2, rowIndex: 1 },
          { reelIndex: 2, rowIndex: 2 },
        ],
        pay: 1000,
      },
    ]);
    expect(breakdown.totalPay).toBe(1000);
    expect(breakdown.totalFreeSpins).toBe(5);
  });

  it('reports all jackpot symbols when the visible count exceeds the threshold', () => {
    const breakdown = calculateWins(
      configWith({ paytable: [], jackpotRequiredVisibleCount: 6 }),
      windowFromRows([
        ['Jackpot', 'Jackpot', 'Jackpot'],
        ['Jackpot', 'Jackpot', 'Jackpot'],
        ['Jackpot', 'Fan', 'Fan'],
        ['Jackpot', 'Fan', 'Fan'],
        ['K', 'K', 'K'],
      ]),
    );

    expect(breakdown.jackpotWins).toEqual([
      expect.objectContaining({
        id: 'jackpot-6',
        symbolId: 'Jackpot',
        count: 8,
        coordinates: [
          { reelIndex: 0, rowIndex: 0 },
          { reelIndex: 0, rowIndex: 1 },
          { reelIndex: 0, rowIndex: 2 },
          { reelIndex: 1, rowIndex: 0 },
          { reelIndex: 1, rowIndex: 1 },
          { reelIndex: 1, rowIndex: 2 },
          { reelIndex: 2, rowIndex: 0 },
          { reelIndex: 3, rowIndex: 0 },
        ],
      }),
    ]);
  });

  it('uses an explicit jackpot amount when provided', () => {
    const breakdown = calculateWins(
      configWith({ paytable: [], jackpotRequiredVisibleCount: 1 }),
      windowFromRows([['Jackpot'], ['Fan'], ['Fan'], ['Fan'], ['Fan']]),
      { jackpotAmount: 1234 },
    );

    expect(breakdown.jackpotWins[0]?.pay).toBe(1234);
    expect(breakdown.totalPay).toBe(1234);
  });

  it('rejects invalid explicit jackpot amounts', () => {
    expect(() =>
      calculateWins(
        configWith({ paytable: [], jackpotRequiredVisibleCount: 1 }),
        windowFromRows([['Jackpot'], ['Fan'], ['Fan'], ['Fan'], ['Fan']]),
        { jackpotAmount: -1 },
      ),
    ).toThrow(/Jackpot amount must be a non-negative safe integer/);
    expect(() =>
      calculateWins(
        configWith({ paytable: [], jackpotRequiredVisibleCount: 1 }),
        windowFromRows([['Jackpot'], ['Fan'], ['Fan'], ['Fan'], ['Fan']]),
        { jackpotAmount: 1.5 },
      ),
    ).toThrow(/Jackpot amount must be a non-negative safe integer/);
  });

  it('reports unreachable paytable entries in the current client config', () => {
    const diagnostics = findWinCalculationDiagnostics(currentClientConfig);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNREACHABLE_PAYTABLE_ENTRY',
          severity: 'warning',
          path: ['paytable', 'scroll-3'],
        }),
        expect.objectContaining({
          code: 'UNREACHABLE_PAYTABLE_ENTRY',
          path: ['paytable', 'scroll-4'],
        }),
        expect.objectContaining({
          code: 'UNREACHABLE_PAYTABLE_ENTRY',
          path: ['paytable', 'scroll-5'],
        }),
      ]),
    );
  });
});

const baseSymbols: SymbolMetadata[] = [
  { id: 'Fan', useWildSubstitute: true },
  { id: 'Sycee', useWildSubstitute: true },
  { id: 'CoinsHeap', useWildSubstitute: true },
  { id: 'K', useWildSubstitute: true },
  { id: 'A', useWildSubstitute: true },
  { id: 'Wild', useWildSubstitute: false },
  { id: 'Scatter', useWildSubstitute: false },
  { id: 'Jackpot', useWildSubstitute: false },
];

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

function configWith(
  overrides: {
    symbols?: SymbolMetadata[];
    paytable?: PaytableEntry[];
    scatterPays?: ScatterPay[];
    jackpotRequiredVisibleCount?: number;
  },
): GameConfiguration {
  const symbols = overrides.symbols ?? baseSymbols;
  return {
    id: 'test-config',
    versionId: 'test-config-v1',
    symbols,
    reels: [0, 1, 2, 3, 4].map((reelIndex) => ({
      reelIndex,
      visibleRows: 3,
      symbols: symbols.map((symbol) => symbol.id),
    })),
    waysPolicy: {
      kind: 'ways',
      reels: 5,
      rows: 3,
      totalWays: 243,
      direction: 'left-to-right',
    },
    paytable: overrides.paytable ?? [],
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
      pays: overrides.scatterPays ?? [],
    },
    jackpotRule: {
      enabled: true,
      symbolId: 'Jackpot',
      requiredVisibleCount: overrides.jackpotRequiredVisibleCount ?? 99,
      defaultAmount: 1000,
      incrementPerSpin: 1,
    },
    limits: {
      minBet: 1,
      maxBet: 20,
      maxSingleSpinPayout: 1000,
    },
  };
}

function windowFromRows(reels: string[][]): VisibleWindow {
  return {
    rows: Math.max(...reels.map((reel) => reel.length)),
    reels: reels.map((symbols, reelIndex) =>
      symbols.map((symbolId, rowIndex) => ({
        reelIndex,
        rowIndex,
        symbolId,
        stripIndex: rowIndex,
      })),
    ),
  };
}

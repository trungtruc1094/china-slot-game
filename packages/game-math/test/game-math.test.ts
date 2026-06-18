import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  currentClientConfig,
  currentClientConfigDiagnostics,
} from './fixtures/current-client-config.js';
import type {
  GameConfiguration,
  JackpotRule,
  MathDiagnostic,
  PaytableEntry,
  PayoutPolicy,
  ReelStop,
  ReelStrip,
  ScatterRule,
  SpinResult,
  SymbolMetadata,
  VisibleSymbol,
  VisibleWindow,
  WagerInput,
  WayWin,
  WaysPolicy,
  WildRule,
  WinBreakdown,
} from '../src/index.js';

describe('game math package public contract', () => {
  it('exposes canonical game math types for backend, RTP, and simulation callers', () => {
    const waysPolicy: WaysPolicy = {
      kind: 'ways',
      reels: 5,
      rows: 3,
      totalWays: 243,
      direction: 'left-to-right',
    };
    const reelStrip: ReelStrip = {
      reelIndex: 0,
      symbols: ['Fan', 'Sycee', 'J'],
      visibleRows: 3,
    };
    const visibleSymbol: VisibleSymbol = {
      reelIndex: 0,
      rowIndex: 0,
      symbolId: 'Fan',
      stripIndex: 0,
    };
    const visibleWindow: VisibleWindow = {
      reels: [[visibleSymbol]],
      rows: 3,
    };
    const paytableEntry: PaytableEntry = {
      id: 'fan-3',
      symbols: ['Fan', 'Fan', 'Fan', 'any', 'any'],
      pay: 2,
      freeSpins: 0,
    };
    const symbolMetadata: SymbolMetadata = {
      id: 'Fan',
      useWildSubstitute: true,
    };
    const payoutPolicy: PayoutPolicy = {
      useLineBetMultiplier: true,
      useLineBetFreeSpinMultiplier: false,
    };
    const wildRule: WildRule = {
      enabled: true,
      symbolId: 'Wild',
      substitutesFromReelIndex: 1,
    };
    const scatterRule: ScatterRule = {
      enabled: true,
      symbolId: 'Scatter',
      pays: [{ count: 5, pay: 0, freeSpins: 5 }],
    };
    const jackpotRule: JackpotRule = {
      enabled: true,
      symbolId: 'Jackpot',
      requiredVisibleCount: 6,
      defaultAmount: 1000,
      incrementPerSpin: 1,
    };
    const reelStop: ReelStop = { reelIndex: 0, stopIndex: 0 };
    const wagerInput: WagerInput = {
      lineBet: 1,
      selectedWays: 243,
      totalWager: 243,
    };
    const wayWin: WayWin = {
      id: 'way-1',
      symbolId: 'Fan',
      matchedReels: 3,
      coordinates: [{ reelIndex: 0, rowIndex: 0 }],
      pay: 2,
      freeSpins: 0,
    };
    const winBreakdown: WinBreakdown = {
      wayWins: [wayWin],
      scatterWins: [],
      jackpotWins: [],
      totalPay: 2,
      totalFreeSpins: 0,
    };
    const spinResult: SpinResult = {
      configId: 'fixture',
      configVersionId: 'fixture-v1',
      reelStops: [reelStop],
      visibleWindow,
      wager: wagerInput,
      winBreakdown,
      totalPayout: 2,
      rng: { type: 'seeded', seed: 'test-seed' },
    };
    const diagnostic: MathDiagnostic = {
      code: 'UNREACHABLE_PAYTABLE_ENTRY',
      severity: 'warning',
      message: 'Fixture diagnostic',
      path: ['paytable', '0'],
    };
    const config: GameConfiguration = {
      id: 'fixture',
      versionId: 'fixture-v1',
      symbols: [symbolMetadata],
      reels: [reelStrip],
      waysPolicy,
      paytable: [paytableEntry],
      payoutPolicy,
      wildRule,
      scatterRule,
      jackpotRule,
      limits: {
        minBet: 1,
        maxBet: 20,
        maxSingleSpinPayout: 1000,
      },
    };

    expect(config.waysPolicy.totalWays).toBe(243);
    expect(spinResult.winBreakdown.totalPay).toBe(2);
    expect(diagnostic.severity).toBe('warning');
  });

  it('contains a current 5-reel, 3-row client config fixture', () => {
    expect(currentClientConfig.reels).toHaveLength(5);
    expect(currentClientConfig.reels.every((reel) => reel.visibleRows === 3)).toBe(true);
    expect(currentClientConfig.waysPolicy).toMatchObject({
      kind: 'ways',
      reels: 5,
      rows: 3,
      totalWays: 243,
      direction: 'left-to-right',
    });
    expect(currentClientConfig.paytable.length).toBeGreaterThan(0);
    expect(currentClientConfig.payoutPolicy).toEqual({
      useLineBetMultiplier: true,
      useLineBetFreeSpinMultiplier: false,
    });
    expect(currentClientConfig.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '10', useWildSubstitute: true }),
        expect.objectContaining({ id: 'Wild', useWildSubstitute: false }),
        expect.objectContaining({ id: 'Scatter', useWildSubstitute: false }),
        expect.objectContaining({ id: 'Jackpot', useWildSubstitute: false }),
      ]),
    );
    expect(currentClientConfig.scatterRule).toMatchObject({
      enabled: true,
      symbolId: 'Scatter',
    });
    expect(currentClientConfig.jackpotRule).toMatchObject({
      enabled: true,
      symbolId: 'Jackpot',
      requiredVisibleCount: 6,
    });
  });

  it('records known diagnostics without implementing RTP or win calculation yet', () => {
    expect(currentClientConfigDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNREACHABLE_PAYTABLE_ENTRY' }),
        expect.objectContaining({ code: 'UNUSED_SYMBOL_METADATA' }),
        expect.objectContaining({ code: 'SERVER_EXAMPLE_MISMATCH' }),
      ]),
    );
  });

  it('stays isolated from server, database, browser, Phaser, and legacy example imports', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies).toEqual({});
    expect(packageJson.devDependencies).toEqual({});

    const packageRoot = new URL('..', import.meta.url);
    const packageText = collectTextFiles(packageRoot.pathname).join('\n');
    expect(packageText).not.toMatch(/\bfrom\s+['"](?:express|pg|@prisma\/client|phaser)['"]/);
    expect(packageText).not.toMatch(/\bimport\(\s*['"](?:express|pg|@prisma\/client|phaser)['"]\s*\)/);
    expect(packageText).not.toMatch(/\brequire\(\s*['"](?:express|pg|@prisma\/client|phaser)['"]\s*\)/);

    const sourceText = collectTextFiles(new URL('../src', import.meta.url).pathname).join('\n');
    expect(sourceText).not.toMatch(/\b(window|document|Phaser)\b/);
  });
});

function collectTextFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return collectTextFiles(path);
    }
    return path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

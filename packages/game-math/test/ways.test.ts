import { describe, expect, it } from 'vitest';

import { buildVisibleWindow, generateWays } from '../src/index.js';
import { currentClientConfig } from './fixtures/current-client-config.js';
import type { GameConfiguration, ReelStop } from '../src/index.js';

describe('243-ways reel windows', () => {
  it('builds a visible window from configured reel stops', () => {
    const window = buildVisibleWindow(currentClientConfig, stops([0, 0, 0, 0, 0]));

    expect(window.rows).toBe(3);
    expect(window.reels).toHaveLength(5);
    expect(window.reels[0]).toEqual([
      { reelIndex: 0, rowIndex: 0, stripIndex: 0, symbolId: 'Fan' },
      { reelIndex: 0, rowIndex: 1, stripIndex: 1, symbolId: 'Sycee' },
      { reelIndex: 0, rowIndex: 2, stripIndex: 2, symbolId: 'J' },
    ]);
  });

  it('wraps visible window rows at the end of reel strips', () => {
    const window = buildVisibleWindow(currentClientConfig, stops([8, 0, 0, 0, 14]));

    expect(window.reels[0]).toEqual([
      { reelIndex: 0, rowIndex: 0, stripIndex: 8, symbolId: 'A' },
      { reelIndex: 0, rowIndex: 1, stripIndex: 9, symbolId: 'CoinsHeap' },
      { reelIndex: 0, rowIndex: 2, stripIndex: 0, symbolId: 'Fan' },
    ]);
    expect(window.reels[4]).toEqual([
      { reelIndex: 4, rowIndex: 0, stripIndex: 14, symbolId: 'Teapot' },
      { reelIndex: 4, rowIndex: 1, stripIndex: 15, symbolId: 'Jackpot' },
      { reelIndex: 4, rowIndex: 2, stripIndex: 0, symbolId: 'CoinsHeap' },
    ]);
  });

  it('generates all 243 left-to-right row combinations in legacy order', () => {
    const window = buildVisibleWindow(currentClientConfig, stops([0, 0, 0, 0, 0]));
    const ways = generateWays(window);

    expect(ways).toHaveLength(243);
    expect(rowIndexes(ways[0])).toEqual([0, 0, 0, 0, 0]);
    expect(rowIndexes(ways[1])).toEqual([0, 0, 0, 0, 1]);
    expect(rowIndexes(ways[2])).toEqual([0, 0, 0, 0, 2]);
    expect(rowIndexes(ways.at(-1))).toEqual([2, 2, 2, 2, 2]);
  });

  it('maps generated ways back to visible window symbols', () => {
    const window = buildVisibleWindow(currentClientConfig, stops([8, 0, 0, 0, 14]));
    const ways = generateWays(window);
    const firstWay = ways[0];
    const lastWay = ways.at(-1);

    expect(firstWay?.symbols.map((symbol) => symbol.symbolId)).toEqual([
      'A',
      'Sycee',
      'Sycee',
      'Fan',
      'Teapot',
    ]);
    expect(lastWay?.symbols.map((symbol) => symbol.symbolId)).toEqual([
      'Fan',
      'Wild',
      'K',
      'Wild',
      'CoinsHeap',
    ]);
  });

  it('uses configured reel indexes in generated way coordinates', () => {
    const config = withReelIndexes([10, 20, 30, 40, 50]);
    const window = buildVisibleWindow(
      config,
      config.reels.map((reel) => ({ reelIndex: reel.reelIndex, stopIndex: 0 })),
    );
    const ways = generateWays(window);

    expect(ways[0]?.coordinates).toEqual([
      { reelIndex: 10, rowIndex: 0 },
      { reelIndex: 20, rowIndex: 0 },
      { reelIndex: 30, rowIndex: 0 },
      { reelIndex: 40, rowIndex: 0 },
      { reelIndex: 50, rowIndex: 0 },
    ]);
    expect(ways[1]?.coordinates.at(-1)).toEqual({ reelIndex: 50, rowIndex: 1 });
  });

  it('rejects configs whose reel row count disagrees with the ways policy', () => {
    const config = {
      ...currentClientConfig,
      waysPolicy: { ...currentClientConfig.waysPolicy, rows: 4, totalWays: 1024 },
    } satisfies GameConfiguration;

    expect(() => buildVisibleWindow(config, stops([0, 0, 0, 0, 0]))).toThrow(
      /does not match ways policy rows/,
    );
  });

  it('rejects duplicate configured reel indexes', () => {
    const config = withReelIndexes([0, 0, 2, 3, 4]);

    expect(() => buildVisibleWindow(config, stops([0, 0, 0, 0, 0]))).toThrow(
      /Duplicate configured reel index/,
    );
  });
});

function stops(stopIndexes: [number, number, number, number, number]): ReelStop[] {
  return stopIndexes.map((stopIndex, reelIndex) => ({ reelIndex, stopIndex }));
}

function withReelIndexes(
  reelIndexes: [number, number, number, number, number],
): GameConfiguration {
  return {
    ...currentClientConfig,
    reels: currentClientConfig.reels.map((reel, index) => ({
      ...reel,
      reelIndex: reelIndexes[index] ?? index,
    })),
  };
}

function rowIndexes(
  way:
    | {
        coordinates: Array<{ rowIndex: number }>;
      }
    | undefined,
): number[] {
  return way?.coordinates.map((coordinate) => coordinate.rowIndex) ?? [];
}

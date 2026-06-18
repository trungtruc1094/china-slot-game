import type {
  GameConfiguration,
  GeneratedWay,
  IntegerUnit,
  JackpotWin,
  MathDiagnostic,
  PaylineSymbol,
  PaytableEntry,
  ScatterWin,
  SymbolId,
  VisibleSymbol,
  VisibleWindow,
  WayWin,
  WinBreakdown,
  WinCoordinate,
} from './config-types.js';
import { generateWays } from './ways.js';

export interface CalculateWinsOptions {
  jackpotAmount?: IntegerUnit;
}

interface PaytableMatch {
  entry: PaytableEntry;
  entryIndex: number;
  coordinates: WinCoordinate[];
  matchedReels: number;
  symbolId: SymbolId;
}

export function calculateWins(
  config: GameConfiguration,
  visibleWindow: VisibleWindow,
  options: CalculateWinsOptions = {},
): WinBreakdown {
  const wayWins = calculateWayWins(config, visibleWindow);
  const scatterWins = calculateScatterWins(config, visibleWindow);
  const jackpotWins = calculateJackpotWins(config, visibleWindow, options.jackpotAmount);

  return {
    wayWins,
    scatterWins,
    jackpotWins,
    totalPay: [
      ...wayWins.map((win) => win.pay),
      ...scatterWins.map((win) => win.pay),
      ...jackpotWins.map((win) => win.pay),
    ].reduce((total, pay) => total + pay, 0),
    totalFreeSpins: [
      ...wayWins.map((win) => win.freeSpins),
      ...scatterWins.map((win) => win.freeSpins),
    ].reduce((total, freeSpins) => total + freeSpins, 0),
  };
}

export function findWinCalculationDiagnostics(config: GameConfiguration): MathDiagnostic[] {
  return config.paytable.flatMap((entry) => {
    const unreachable = findFirstUnreachableRequiredSymbol(config, entry);
    if (!unreachable) {
      return [];
    }

    return [
      {
        code: 'UNREACHABLE_PAYTABLE_ENTRY',
        severity: 'warning',
        message: `Paytable entry ${entry.id} requires ${unreachable.symbolId} on reel ${unreachable.reelIndex}, but that symbol cannot appear there.`,
        path: ['paytable', entry.id],
      },
    ];
  });
}

function calculateWayWins(
  config: GameConfiguration,
  visibleWindow: VisibleWindow,
): WayWin[] {
  return generateWays(visibleWindow).flatMap((way) => {
    const bestMatch = findBestPaytableMatch(config, way);
    if (!bestMatch) {
      return [];
    }

    return [
      {
        id: `${way.id}:${bestMatch.entry.id}`,
        symbolId: bestMatch.symbolId,
        matchedReels: bestMatch.matchedReels,
        coordinates: bestMatch.coordinates,
        pay: bestMatch.entry.pay,
        freeSpins: bestMatch.entry.freeSpins,
      },
    ];
  });
}

function findBestPaytableMatch(
  config: GameConfiguration,
  way: GeneratedWay,
): PaytableMatch | undefined {
  return config.paytable.reduce<PaytableMatch | undefined>((bestMatch, entry, entryIndex) => {
    const match = matchPaytableEntry(config, way, entry, entryIndex);
    if (!match) {
      return bestMatch;
    }
    if (!bestMatch || comparePaytableMatches(match, bestMatch) > 0) {
      return match;
    }
    return bestMatch;
  }, undefined);
}

function matchPaytableEntry(
  config: GameConfiguration,
  way: GeneratedWay,
  entry: PaytableEntry,
  entryIndex: number,
): PaytableMatch | undefined {
  const requiredSymbols = getRequiredPrefixSymbols(entry);
  if (requiredSymbols.length === 0) {
    return undefined;
  }

  const coordinates: WinCoordinate[] = [];
  for (const [position, paylineSymbol] of requiredSymbols.entries()) {
    const visibleSymbol = way.symbols[position];
    if (!visibleSymbol || !matchesPaylineSymbol(config, visibleSymbol, paylineSymbol)) {
      return undefined;
    }

    coordinates.push({
      reelIndex: visibleSymbol.reelIndex,
      rowIndex: visibleSymbol.rowIndex,
    });
  }

  return {
    entry,
    entryIndex,
    coordinates,
    matchedReels: coordinates.length,
    symbolId: requiredSymbols[0] ?? entry.id,
  };
}

function comparePaytableMatches(candidate: PaytableMatch, current: PaytableMatch): number {
  if (candidate.entry.pay !== current.entry.pay) {
    return candidate.entry.pay - current.entry.pay;
  }
  if (candidate.entry.freeSpins !== current.entry.freeSpins) {
    return candidate.entry.freeSpins - current.entry.freeSpins;
  }
  if (candidate.matchedReels !== current.matchedReels) {
    return candidate.matchedReels - current.matchedReels;
  }
  return current.entryIndex - candidate.entryIndex;
}

function matchesPaylineSymbol(
  config: GameConfiguration,
  visibleSymbol: VisibleSymbol,
  paylineSymbol: PaylineSymbol,
): boolean {
  if (paylineSymbol === 'any') {
    return true;
  }
  if (visibleSymbol.symbolId === paylineSymbol) {
    return true;
  }
  return canWildSubstitute(config, visibleSymbol, paylineSymbol);
}

function canWildSubstitute(
  config: GameConfiguration,
  visibleSymbol: VisibleSymbol,
  targetSymbolId: SymbolId,
): boolean {
  if (!config.wildRule.enabled || visibleSymbol.symbolId !== config.wildRule.symbolId) {
    return false;
  }
  if (visibleSymbol.reelIndex < config.wildRule.substitutesFromReelIndex) {
    return false;
  }
  const targetMetadata = config.symbols.find((symbol) => symbol.id === targetSymbolId);
  return targetMetadata?.useWildSubstitute === true;
}

function calculateScatterWins(
  config: GameConfiguration,
  visibleWindow: VisibleWindow,
): ScatterWin[] {
  if (!config.scatterRule.enabled) {
    return [];
  }

  const scatterSymbols = flattenVisibleSymbols(visibleWindow).filter(
    (symbol) => symbol.symbolId === config.scatterRule.symbolId,
  );
  const scatterPay = config.scatterRule.pays.find((pay) => pay.count === scatterSymbols.length);
  if (!scatterPay) {
    return [];
  }

  return [
    {
      id: `scatter-${scatterSymbols.length}`,
      symbolId: config.scatterRule.symbolId,
      count: scatterSymbols.length,
      coordinates: toCoordinates(scatterSymbols),
      pay: scatterPay.pay,
      freeSpins: scatterPay.freeSpins,
    },
  ];
}

function calculateJackpotWins(
  config: GameConfiguration,
  visibleWindow: VisibleWindow,
  jackpotAmount: IntegerUnit | undefined,
): JackpotWin[] {
  if (!config.jackpotRule.enabled) {
    return [];
  }

  const resolvedJackpotAmount = jackpotAmount ?? config.jackpotRule.defaultAmount;
  validatePayoutInteger('Jackpot amount', resolvedJackpotAmount);

  const jackpotSymbols = flattenVisibleSymbols(visibleWindow).filter(
    (symbol) => symbol.symbolId === config.jackpotRule.symbolId,
  );
  if (jackpotSymbols.length < config.jackpotRule.requiredVisibleCount) {
    return [];
  }

  return [
    {
      id: `jackpot-${config.jackpotRule.requiredVisibleCount}`,
      symbolId: config.jackpotRule.symbolId,
      count: jackpotSymbols.length,
      coordinates: toCoordinates(jackpotSymbols),
      pay: resolvedJackpotAmount,
    },
  ];
}

function flattenVisibleSymbols(visibleWindow: VisibleWindow): VisibleSymbol[] {
  return visibleWindow.reels.flatMap((reel) => reel);
}

function toCoordinates(symbols: VisibleSymbol[]): WinCoordinate[] {
  return symbols.map((symbol) => ({
    reelIndex: symbol.reelIndex,
    rowIndex: symbol.rowIndex,
  }));
}

function findFirstUnreachableRequiredSymbol(
  config: GameConfiguration,
  entry: PaytableEntry,
): { reelIndex: number; symbolId: SymbolId } | undefined {
  for (const [position, paylineSymbol] of getRequiredPrefixSymbols(entry).entries()) {
    const reel = config.reels[position];
    if (!reel) {
      return { reelIndex: position, symbolId: paylineSymbol };
    }
    if (!isSymbolReachableOnReel(config, reel.reelIndex, reel.symbols, paylineSymbol)) {
      return { reelIndex: reel.reelIndex, symbolId: paylineSymbol };
    }
  }
  return undefined;
}

function isSymbolReachableOnReel(
  config: GameConfiguration,
  reelIndex: number,
  reelSymbols: SymbolId[],
  targetSymbolId: SymbolId,
): boolean {
  if (reelSymbols.includes(targetSymbolId)) {
    return true;
  }
  if (!config.wildRule.enabled || reelIndex < config.wildRule.substitutesFromReelIndex) {
    return false;
  }
  if (!reelSymbols.includes(config.wildRule.symbolId)) {
    return false;
  }
  const targetMetadata = config.symbols.find((symbol) => symbol.id === targetSymbolId);
  return targetMetadata?.useWildSubstitute === true;
}

function getRequiredPrefixSymbols(entry: PaytableEntry): SymbolId[] {
  const firstAnyIndex = entry.symbols.findIndex((symbol) => symbol === 'any');
  const prefixEnd = firstAnyIndex === -1 ? entry.symbols.length : firstAnyIndex;
  const requiredPrefix = entry.symbols.slice(0, prefixEnd);
  if (requiredPrefix.some((symbol) => symbol === 'any')) {
    return [];
  }
  if (entry.symbols.slice(prefixEnd).some((symbol) => symbol !== 'any')) {
    return [];
  }
  return requiredPrefix as SymbolId[];
}

function validatePayoutInteger(label: string, value: IntegerUnit): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

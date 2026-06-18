import type {
  GameConfiguration,
  IntegerUnit,
  MathDiagnostic,
  PaylineSymbol,
  ReelStop,
  RtpCalculationInput,
  RtpReport,
} from './config-types.js';
import { buildVisibleWindow, generateWays } from './ways.js';
import { calculateWins, findWinCalculationDiagnostics } from './win-calculator.js';

export interface CalculateRtpReportOptions {
  wager?: RtpCalculationInput;
  includeServerExampleMismatchDiagnostic?: boolean;
}

export interface ConfigurationDiagnosticOptions {
  includeServerExampleMismatchDiagnostic?: boolean;
}

const DEFAULT_WAGER: RtpCalculationInput = {
  lineBet: 1,
  selectedWays: 243,
  totalWager: 243,
};

export function calculateRtpReport(
  config: GameConfiguration,
  options: CalculateRtpReportOptions = {},
): RtpReport {
  const wager = options.wager ?? DEFAULT_WAGER;
  validateWager(wager);
  validateReelsForEnumeration(config);

  const distributionCounts = new Map<IntegerUnit, number>();
  let totalOutcomes = 0;
  let totalWagered = 0;
  let totalPaid = 0;
  let outcomesWithHit = 0;
  let outcomesWithFreeSpins = 0;
  let outcomesWithJackpot = 0;
  let maxPayoutExposure = 0;

  for (const reelStops of enumerateReelStops(config)) {
    const visibleWindow = buildVisibleWindow(config, reelStops);
    const winBreakdown = calculateWins(config, visibleWindow);
    const outcomePay = resolveOutcomePay(config, winBreakdown.totalPay, wager);
    totalOutcomes++;
    totalWagered += wager.totalWager;
    totalPaid += outcomePay;
    if (outcomePay > 0 || winBreakdown.totalFreeSpins > 0) {
      outcomesWithHit++;
    }
    if (winBreakdown.totalFreeSpins > 0) {
      outcomesWithFreeSpins++;
    }
    if (winBreakdown.jackpotWins.length > 0) {
      outcomesWithJackpot++;
    }
    maxPayoutExposure = Math.max(maxPayoutExposure, outcomePay);
    distributionCounts.set(
      outcomePay,
      (distributionCounts.get(outcomePay) ?? 0) + 1,
    );
  }

  const payoutDistribution = [...distributionCounts.entries()]
    .sort(([leftPayout], [rightPayout]) => leftPayout - rightPayout)
    .map(([payout, count]) => ({
      payout,
      count,
      probability: count / totalOutcomes,
    }));

  return {
    configId: config.id,
    configVersionId: config.versionId,
    totalOutcomes,
    totalWagered,
    totalPaid,
    theoreticalRtp: totalPaid / totalWagered,
    hitRate: outcomesWithHit / totalOutcomes,
    freeSpinTriggerFrequency: outcomesWithFreeSpins / totalOutcomes,
    jackpotTriggerFrequency: outcomesWithJackpot / totalOutcomes,
    maxPayoutExposure,
    payoutDistribution,
    diagnostics: findConfigurationDiagnostics(
      config,
      options.includeServerExampleMismatchDiagnostic === undefined
        ? {}
        : {
            includeServerExampleMismatchDiagnostic:
              options.includeServerExampleMismatchDiagnostic,
          },
    ),
  };
}

export function findConfigurationDiagnostics(
  config: GameConfiguration,
  options: ConfigurationDiagnosticOptions = {},
): MathDiagnostic[] {
  return [
    ...findMissingSymbolMetadataDiagnostics(config),
    ...findWinCalculationDiagnostics(config),
    ...findUnusedSymbolMetadataDiagnostics(config),
    ...findScatterRuleDiagnostics(config),
    ...findJackpotRuleDiagnostics(config),
    ...findConfigShapeDiagnostics(config),
    ...findServerExampleMismatchDiagnostics(options),
  ];
}

function* enumerateReelStops(config: GameConfiguration): Generator<ReelStop[]> {
  const currentStops: ReelStop[] = [];

  function* visit(reelPosition: number): Generator<ReelStop[]> {
    if (reelPosition === config.reels.length) {
      yield currentStops.map((stop) => ({ ...stop }));
      return;
    }

    const reel = config.reels[reelPosition];
    if (!reel) {
      throw new Error(`Missing reel at position ${reelPosition}.`);
    }

    for (let stopIndex = 0; stopIndex < reel.symbols.length; stopIndex++) {
      currentStops[reelPosition] = {
        reelIndex: reel.reelIndex,
        stopIndex,
      };
      yield* visit(reelPosition + 1);
    }
  }

  yield* visit(0);
}

function validateWager(wager: RtpCalculationInput): void {
  validatePositiveInteger('lineBet', wager.lineBet);
  validatePositiveInteger('selectedWays', wager.selectedWays);
  validatePositiveInteger('totalWager', wager.totalWager);
}

function resolveOutcomePay(
  config: GameConfiguration,
  basePay: IntegerUnit,
  wager: RtpCalculationInput,
): IntegerUnit {
  return config.payoutPolicy.useLineBetMultiplier ? basePay * wager.lineBet : basePay;
}

function validateReelsForEnumeration(config: GameConfiguration): void {
  if (config.reels.length === 0) {
    throw new Error('Cannot calculate RTP for a configuration with no reels.');
  }
  for (const reel of config.reels) {
    if (reel.symbols.length === 0) {
      throw new Error(`Cannot calculate RTP because reel ${reel.reelIndex} has no symbols.`);
    }
  }
}

function validatePositiveInteger(label: string, value: IntegerUnit): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function findMissingSymbolMetadataDiagnostics(config: GameConfiguration): MathDiagnostic[] {
  const metadataIds = new Set(config.symbols.map((symbol) => symbol.id));
  return [...collectReferencedSymbols(config)]
    .filter((symbolId) => !metadataIds.has(symbolId))
    .sort()
    .map((symbolId) => ({
      code: 'MISSING_SYMBOL_METADATA',
      severity: 'error',
      message: `Symbol ${symbolId} is referenced by the configuration but is missing from symbol metadata.`,
      path: ['symbols', symbolId],
    }));
}

function findUnusedSymbolMetadataDiagnostics(config: GameConfiguration): MathDiagnostic[] {
  const referencedSymbols = collectReferencedSymbols(config);
  return config.symbols
    .filter((symbol) => !referencedSymbols.has(symbol.id))
    .map((symbol) => ({
      code: 'UNUSED_SYMBOL_METADATA',
      severity: 'warning',
      message: `Symbol metadata ${symbol.id} is not used by reels, paytable, wild, scatter, or jackpot rules.`,
      path: ['symbols', symbol.id],
    }));
}

function findScatterRuleDiagnostics(config: GameConfiguration): MathDiagnostic[] {
  if (!config.scatterRule.enabled) {
    return [];
  }

  const diagnostics: MathDiagnostic[] = [];
  if (config.scatterRule.pays.length === 0) {
    diagnostics.push({
      code: 'INVALID_SCATTER_RULE',
      severity: 'warning',
      message: 'Scatter rule is enabled but has no configured pays.',
      path: ['scatterRule', 'pays'],
    });
  }

  for (const [index, pay] of config.scatterRule.pays.entries()) {
    if (!Number.isSafeInteger(pay.count) || pay.count <= 0) {
      diagnostics.push({
        code: 'INVALID_SCATTER_RULE',
        severity: 'error',
        message: `Scatter pay at index ${index} must use a positive safe integer count.`,
        path: ['scatterRule', 'pays', String(index), 'count'],
      });
    }
    if (!isNonNegativeInteger(pay.pay) || !isNonNegativeInteger(pay.freeSpins)) {
      diagnostics.push({
        code: 'INVALID_SCATTER_RULE',
        severity: 'error',
        message: `Scatter pay at index ${index} must use non-negative safe integer pay and freeSpins values.`,
        path: ['scatterRule', 'pays', String(index)],
      });
    }
  }

  if (!isSymbolOnAnyReel(config, config.scatterRule.symbolId)) {
    diagnostics.push({
      code: 'INVALID_SCATTER_RULE',
      severity: 'warning',
      message: `Scatter symbol ${config.scatterRule.symbolId} is not present on any active reel strip.`,
      path: ['scatterRule', 'symbolId'],
    });
  }

  return diagnostics;
}

function findJackpotRuleDiagnostics(config: GameConfiguration): MathDiagnostic[] {
  if (!config.jackpotRule.enabled) {
    return [];
  }

  const diagnostics: MathDiagnostic[] = [];
  if (!isSymbolOnAnyReel(config, config.jackpotRule.symbolId)) {
    diagnostics.push({
      code: 'INVALID_JACKPOT_RULE',
      severity: 'warning',
      message: `Jackpot symbol ${config.jackpotRule.symbolId} is not present on any active reel strip.`,
      path: ['jackpotRule', 'symbolId'],
    });
  }
  if (!Number.isSafeInteger(config.jackpotRule.requiredVisibleCount) || config.jackpotRule.requiredVisibleCount <= 0) {
    diagnostics.push({
      code: 'INVALID_JACKPOT_RULE',
      severity: 'error',
      message: 'Jackpot requiredVisibleCount must be a positive safe integer.',
      path: ['jackpotRule', 'requiredVisibleCount'],
    });
  }
  if (!isNonNegativeInteger(config.jackpotRule.defaultAmount)) {
    diagnostics.push({
      code: 'INVALID_JACKPOT_RULE',
      severity: 'error',
      message: 'Jackpot defaultAmount must be a non-negative safe integer.',
      path: ['jackpotRule', 'defaultAmount'],
    });
  }
  if (!isNonNegativeInteger(config.jackpotRule.incrementPerSpin)) {
    diagnostics.push({
      code: 'INVALID_JACKPOT_RULE',
      severity: 'error',
      message: 'Jackpot incrementPerSpin must be a non-negative safe integer.',
      path: ['jackpotRule', 'incrementPerSpin'],
    });
  }
  return diagnostics;
}

function findConfigShapeDiagnostics(config: GameConfiguration): MathDiagnostic[] {
  const diagnostics: MathDiagnostic[] = [];
  if (config.waysPolicy.kind !== 'ways') {
    diagnostics.push({
      code: 'CONFIG_SHAPE_WARNING',
      severity: 'warning',
      message: `Unsupported ways policy kind ${config.waysPolicy.kind}.`,
      path: ['waysPolicy', 'kind'],
    });
  }

  const actualWays = config.waysPolicy.rows ** config.reels.length;
  if (actualWays !== config.waysPolicy.totalWays) {
    diagnostics.push({
      code: 'CONFIG_SHAPE_WARNING',
      severity: 'warning',
      message: `Ways policy totalWays ${config.waysPolicy.totalWays} does not match ${actualWays} generated ways per visible grid.`,
      path: ['waysPolicy', 'totalWays'],
    });
  }

  const firstWindowStops = config.reels.map((reel) => ({
    reelIndex: reel.reelIndex,
    stopIndex: 0,
  }));
  if (firstWindowStops.length > 0 && config.reels.every((reel) => reel.symbols.length > 0)) {
    const generatedWays = generateWays(buildVisibleWindow(config, firstWindowStops)).length;
    if (generatedWays !== config.waysPolicy.totalWays) {
      diagnostics.push({
        code: 'CONFIG_SHAPE_WARNING',
        severity: 'warning',
        message: `Generated ${generatedWays} ways per visible grid, expected ${config.waysPolicy.totalWays}.`,
        path: ['waysPolicy', 'totalWays'],
      });
    }
  }

  return diagnostics;
}

function findServerExampleMismatchDiagnostics(
  options: ConfigurationDiagnosticOptions,
): MathDiagnostic[] {
  if (!options.includeServerExampleMismatchDiagnostic) {
    return [];
  }
  return [
    {
      code: 'SERVER_EXAMPLE_MISMATCH',
      severity: 'warning',
      message: 'server_examples/server.js uses simplified paylines and does not match the browser 243-ways behavior.',
      path: ['server_examples', 'server.js'],
    },
  ];
}

function collectReferencedSymbols(config: GameConfiguration): Set<string> {
  const symbols = new Set<string>();
  for (const reel of config.reels) {
    for (const symbol of reel.symbols) {
      symbols.add(symbol);
    }
  }
  for (const entry of config.paytable) {
    for (const symbol of entry.symbols) {
      addPaylineSymbol(symbols, symbol);
    }
  }
  if (config.wildRule.enabled) {
    symbols.add(config.wildRule.symbolId);
  }
  if (config.scatterRule.enabled) {
    symbols.add(config.scatterRule.symbolId);
  }
  if (config.jackpotRule.enabled) {
    symbols.add(config.jackpotRule.symbolId);
  }
  return symbols;
}

function addPaylineSymbol(symbols: Set<string>, symbol: PaylineSymbol): void {
  if (symbol !== 'any') {
    symbols.add(symbol);
  }
}

function isSymbolOnAnyReel(config: GameConfiguration, symbolId: string): boolean {
  return config.reels.some((reel) => reel.symbols.includes(symbolId));
}

function isNonNegativeInteger(value: IntegerUnit): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

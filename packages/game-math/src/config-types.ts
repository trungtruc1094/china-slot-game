export type SymbolId = string;

export type PaylineSymbol = SymbolId | 'any';

export type IntegerUnit = number;

export interface PaytableEntry {
  id: string;
  symbols: [PaylineSymbol, PaylineSymbol, PaylineSymbol, PaylineSymbol, PaylineSymbol];
  pay: IntegerUnit;
  freeSpins: IntegerUnit;
}

export interface SymbolMetadata {
  id: SymbolId;
  useWildSubstitute: boolean;
}

export interface ReelStrip {
  reelIndex: number;
  symbols: SymbolId[];
  visibleRows: number;
}

export interface ReelStop {
  reelIndex: number;
  stopIndex: number;
}

export interface VisibleSymbol {
  reelIndex: number;
  rowIndex: number;
  symbolId: SymbolId;
  stripIndex: number;
}

export interface VisibleWindow {
  reels: VisibleSymbol[][];
  rows: number;
}

export interface WaysPolicy {
  kind: 'ways';
  reels: number;
  rows: number;
  totalWays: number;
  direction: 'left-to-right';
}

export interface WildRule {
  enabled: boolean;
  symbolId: SymbolId;
  substitutesFromReelIndex: number;
}

export interface PayoutPolicy {
  useLineBetMultiplier: boolean;
  useLineBetFreeSpinMultiplier: boolean;
}

export interface ScatterPay {
  count: number;
  pay: IntegerUnit;
  freeSpins: IntegerUnit;
}

export interface ScatterRule {
  enabled: boolean;
  symbolId: SymbolId;
  pays: ScatterPay[];
}

export interface JackpotRule {
  enabled: boolean;
  symbolId: SymbolId;
  requiredVisibleCount: number;
  defaultAmount: IntegerUnit;
  incrementPerSpin: IntegerUnit;
}

export interface GameLimits {
  minBet: IntegerUnit;
  maxBet: IntegerUnit;
  maxSingleSpinPayout: IntegerUnit;
}

export interface GameConfiguration {
  id: string;
  versionId: string;
  symbols: SymbolMetadata[];
  reels: ReelStrip[];
  waysPolicy: WaysPolicy;
  paytable: PaytableEntry[];
  payoutPolicy: PayoutPolicy;
  wildRule: WildRule;
  scatterRule: ScatterRule;
  jackpotRule: JackpotRule;
  limits: GameLimits;
}

export interface WagerInput {
  lineBet: IntegerUnit;
  selectedWays: number;
  totalWager: IntegerUnit;
}

export interface WinCoordinate {
  reelIndex: number;
  rowIndex: number;
}

export interface WayCoordinate {
  reelIndex: number;
  rowIndex: number;
}

export interface GeneratedWay {
  id: string;
  coordinates: WayCoordinate[];
  symbols: VisibleSymbol[];
}

export interface WayWin {
  id: string;
  symbolId: SymbolId;
  matchedReels: number;
  coordinates: WinCoordinate[];
  pay: IntegerUnit;
  freeSpins: IntegerUnit;
}

export interface ScatterWin {
  id: string;
  symbolId: SymbolId;
  count: number;
  coordinates: WinCoordinate[];
  pay: IntegerUnit;
  freeSpins: IntegerUnit;
}

export interface JackpotWin {
  id: string;
  symbolId: SymbolId;
  count: number;
  coordinates: WinCoordinate[];
  pay: IntegerUnit;
}

export interface WinBreakdown {
  wayWins: WayWin[];
  scatterWins: ScatterWin[];
  jackpotWins: JackpotWin[];
  totalPay: IntegerUnit;
  totalFreeSpins: IntegerUnit;
}

export interface RtpCalculationInput {
  lineBet: IntegerUnit;
  selectedWays: number;
  totalWager: IntegerUnit;
}

export interface PayoutDistributionBucket {
  payout: IntegerUnit;
  count: number;
  probability: number;
}

export interface RtpReport {
  configId: string;
  configVersionId: string;
  totalOutcomes: number;
  totalWagered: IntegerUnit;
  totalPaid: IntegerUnit;
  theoreticalRtp: number;
  hitRate: number;
  freeSpinTriggerFrequency: number;
  jackpotTriggerFrequency: number;
  maxPayoutExposure: IntegerUnit;
  payoutDistribution: PayoutDistributionBucket[];
  diagnostics: MathDiagnostic[];
}

export interface SimulationInput {
  spinCount: number;
  seed?: string;
  wager?: RtpCalculationInput;
  theoreticalRtp?: number;
}

export interface VolatilitySummary {
  meanPayout: number;
  variance: number;
  standardDeviation: number;
  zeroPayCount: number;
  smallWinCount: number;
  mediumWinCount: number;
  largeWinCount: number;
}

export interface SimulationConfidenceNote {
  code: 'LOW_SAMPLE_SIZE' | 'RTP_DELTA';
  severity: 'info' | 'warning';
  message: string;
}

export interface SimulationResult {
  configId: string;
  configVersionId: string;
  spinCount: number;
  seed: string;
  totalWagered: IntegerUnit;
  totalPaid: IntegerUnit;
  observedRtp: number;
  hitRate: number;
  largestWin: IntegerUnit;
  scatterCount: number;
  jackpotCount: number;
  volatility: VolatilitySummary;
  confidenceNotes: SimulationConfidenceNote[];
}

export type RngMetadata =
  | {
      type: 'seeded';
      seed: string;
    }
  | {
      type: 'system';
      requestId?: string;
    };

export interface SpinResult {
  configId: string;
  configVersionId: string;
  reelStops: ReelStop[];
  visibleWindow: VisibleWindow;
  wager: WagerInput;
  winBreakdown: WinBreakdown;
  totalPayout: IntegerUnit;
  rng: RngMetadata;
}

export type MathDiagnosticCode =
  | 'UNREACHABLE_PAYTABLE_ENTRY'
  | 'UNUSED_SYMBOL_METADATA'
  | 'MISSING_SYMBOL_METADATA'
  | 'INVALID_SCATTER_RULE'
  | 'INVALID_JACKPOT_RULE'
  | 'SERVER_EXAMPLE_MISMATCH'
  | 'CONFIG_SHAPE_WARNING';

export interface MathDiagnostic {
  code: MathDiagnosticCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
  path: string[];
}

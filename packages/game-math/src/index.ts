export type {
  GameConfiguration,
  GameLimits,
  GeneratedWay,
  IntegerUnit,
  JackpotRule,
  JackpotWin,
  MathDiagnostic,
  MathDiagnosticCode,
  PaylineSymbol,
  PaytableEntry,
  PayoutDistributionBucket,
  PayoutPolicy,
  ReelStop,
  ReelStrip,
  RtpCalculationInput,
  RtpReport,
  RngMetadata,
  ScatterPay,
  ScatterRule,
  ScatterWin,
  SimulationConfidenceNote,
  SimulationInput,
  SimulationResult,
  SpinResult,
  SymbolMetadata,
  SymbolId,
  VisibleSymbol,
  VisibleWindow,
  VolatilitySummary,
  WagerInput,
  WayWin,
  WayCoordinate,
  WaysPolicy,
  WildRule,
  WinBreakdown,
  WinCoordinate,
} from './config-types.js';

export { buildVisibleWindow, generateWays } from './ways.js';
export {
  calculateWins,
  findWinCalculationDiagnostics,
} from './win-calculator.js';
export type { CalculateWinsOptions } from './win-calculator.js';
export {
  calculateRtpReport,
  findConfigurationDiagnostics,
} from './rtp-calculator.js';
export type { CalculateRtpReportOptions, ConfigurationDiagnosticOptions } from './rtp-calculator.js';
export { runSimulation } from './simulator.js';

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
  PayoutPolicy,
  ReelStop,
  ReelStrip,
  RngMetadata,
  ScatterPay,
  ScatterRule,
  ScatterWin,
  SpinResult,
  SymbolMetadata,
  SymbolId,
  VisibleSymbol,
  VisibleWindow,
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

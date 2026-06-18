import type {
  GameConfiguration,
  GeneratedWay,
  ReelStop,
  VisibleSymbol,
  VisibleWindow,
  WayCoordinate,
} from './config-types.js';

export function buildVisibleWindow(
  config: GameConfiguration,
  reelStops: ReelStop[],
): VisibleWindow {
  validateReelStops(config, reelStops);

  const stopsByReel = new Map<number, ReelStop>(
    reelStops.map((stop) => [stop.reelIndex, stop]),
  );
  const reels = config.reels.map((reel) => {
    const stop = stopsByReel.get(reel.reelIndex);
    if (!stop) {
      throw new Error(`Missing reel stop for reel ${reel.reelIndex}.`);
    }

    return Array.from({ length: reel.visibleRows }, (_, rowIndex): VisibleSymbol => {
      const stripIndex = (stop.stopIndex + rowIndex) % reel.symbols.length;
      const symbolId = reel.symbols[stripIndex];
      if (symbolId === undefined) {
        throw new Error(`No symbol found for reel ${reel.reelIndex} at strip index ${stripIndex}.`);
      }

      return {
        reelIndex: reel.reelIndex,
        rowIndex,
        symbolId,
        stripIndex,
      };
    });
  });

  return {
    reels,
    rows: config.waysPolicy.rows,
  };
}

export function generateWays(visibleWindow: VisibleWindow): GeneratedWay[] {
  validateVisibleGrid(visibleWindow);

  const maxRowIndexes = visibleWindow.reels.map((reel) => reel.length - 1);
  const positions = Array.from({ length: visibleWindow.reels.length }, (_, reelPosition) => ({
    reelPosition,
    rowIndex: 0,
  }));
  const ways: GeneratedWay[] = [];
  let firstCombination = true;

  while (firstCombination || incrementPositions(positions, maxRowIndexes)) {
    firstCombination = false;
    const symbols = positions.map((position) => {
      const symbol = visibleWindow.reels[position.reelPosition]?.[position.rowIndex];
      if (!symbol) {
        throw new Error(
          `No visible symbol found for reel position ${position.reelPosition}, row ${position.rowIndex}.`,
        );
      }
      return symbol;
    });
    const wayCoordinates = symbols.map(
      (symbol): WayCoordinate => ({
        reelIndex: symbol.reelIndex,
        rowIndex: symbol.rowIndex,
      }),
    );

    ways.push({
      id: `way-${ways.length}`,
      coordinates: wayCoordinates,
      symbols,
    });
  }

  return ways;
}

function validateReelStops(config: GameConfiguration, reelStops: ReelStop[]): void {
  if (reelStops.length !== config.reels.length) {
    throw new Error(`Expected ${config.reels.length} reel stops, received ${reelStops.length}.`);
  }

  if (!Number.isInteger(config.waysPolicy.rows) || config.waysPolicy.rows <= 0) {
    throw new Error('Ways policy rows must be a positive integer.');
  }

  const configuredReelIndexes = new Set<number>();
  for (const reel of config.reels) {
    if (!Number.isInteger(reel.reelIndex)) {
      throw new Error(`Reel index must be an integer: ${reel.reelIndex}.`);
    }
    if (configuredReelIndexes.has(reel.reelIndex)) {
      throw new Error(`Duplicate configured reel index ${reel.reelIndex}.`);
    }
    configuredReelIndexes.add(reel.reelIndex);
  }

  const stopReelIndexes = new Set<number>();
  for (const stop of reelStops) {
    if (!Number.isInteger(stop.reelIndex)) {
      throw new Error(`Reel stop reelIndex must be an integer: ${stop.reelIndex}.`);
    }
    if (stopReelIndexes.has(stop.reelIndex)) {
      throw new Error(`Duplicate reel stop for reel ${stop.reelIndex}.`);
    }
    if (!configuredReelIndexes.has(stop.reelIndex)) {
      throw new Error(`Reel stop references unconfigured reel ${stop.reelIndex}.`);
    }
    stopReelIndexes.add(stop.reelIndex);
  }

  for (const reel of config.reels) {
    if (!Number.isInteger(reel.visibleRows) || reel.visibleRows <= 0) {
      throw new Error(`Reel ${reel.reelIndex} must have a positive integer visibleRows value.`);
    }
    if (reel.visibleRows !== config.waysPolicy.rows) {
      throw new Error(
        `Reel ${reel.reelIndex} visibleRows ${reel.visibleRows} does not match ways policy rows ${config.waysPolicy.rows}.`,
      );
    }
    if (reel.symbols.length === 0) {
      throw new Error(`Reel ${reel.reelIndex} must contain at least one symbol.`);
    }

    const stop = reelStops.find((candidate) => candidate.reelIndex === reel.reelIndex);
    if (!stop) {
      throw new Error(`Missing reel stop for configured reel ${reel.reelIndex}.`);
    }
    if (!Number.isInteger(stop.stopIndex)) {
      throw new Error(`Stop index for reel ${reel.reelIndex} must be an integer.`);
    }
    if (stop.stopIndex < 0 || stop.stopIndex >= reel.symbols.length) {
      throw new Error(
        `Stop index ${stop.stopIndex} is outside reel ${reel.reelIndex} strip bounds.`,
      );
    }
  }
}

function validateVisibleGrid(visibleWindow: VisibleWindow): void {
  if (visibleWindow.reels.length === 0) {
    throw new Error('Visible grid must contain at least one reel.');
  }
  if (!Number.isInteger(visibleWindow.rows) || visibleWindow.rows <= 0) {
    throw new Error('Visible grid rows must be a positive integer.');
  }
  for (const [index, reel] of visibleWindow.reels.entries()) {
    if (reel.length !== visibleWindow.rows) {
      throw new Error(`Visible grid reel ${index} has ${reel.length} rows, expected ${visibleWindow.rows}.`);
    }
  }
}

interface WayPosition {
  reelPosition: number;
  rowIndex: number;
}

function incrementPositions(
  positions: WayPosition[],
  maxRowIndexes: number[],
): boolean {
  for (let index = positions.length - 1; index >= 0; index--) {
    const position = positions[index];
    const maxRowIndex = maxRowIndexes[index];
    if (position === undefined || maxRowIndex === undefined) {
      throw new Error(`Invalid way position at index ${index}.`);
    }
    if (position.rowIndex < maxRowIndex) {
      position.rowIndex++;
      for (let resetIndex = index + 1; resetIndex < positions.length; resetIndex++) {
        const resetPosition = positions[resetIndex];
        if (resetPosition === undefined) {
          throw new Error(`Invalid way position at index ${resetIndex}.`);
        }
        resetPosition.rowIndex = 0;
      }
      return true;
    }
  }
  return false;
}

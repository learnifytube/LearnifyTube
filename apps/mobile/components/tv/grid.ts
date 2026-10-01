export const TV_GRID_ROWS = 2;
export const TV_GRID_SIDE_PADDING = 28;
export const TV_GRID_GAP = 18;

const TV_GRID_WIDE_BREAKPOINT = 1600;
const TV_GRID_NARROW_COLUMNS = 3;
const TV_GRID_WIDE_COLUMNS = 4;
const TV_GRID_CARD_ASPECT_RATIO = 1.6;

export function getTVGridColumns(viewportWidth: number): number {
  return viewportWidth >= TV_GRID_WIDE_BREAKPOINT
    ? TV_GRID_WIDE_COLUMNS
    : TV_GRID_NARROW_COLUMNS;
}

export function getTVGridPageSize(columns: number): number {
  return columns * TV_GRID_ROWS;
}

export function getTVGridCardWidth(
  viewportWidth: number,
  columns: number,
): number {
  const availableWidth =
    viewportWidth - TV_GRID_SIDE_PADDING * 2 - TV_GRID_GAP * (columns - 1);
  return Math.floor(availableWidth / columns);
}

export function getTVGridCardHeight(cardWidth: number): number {
  return Math.round(cardWidth / TV_GRID_CARD_ASPECT_RATIO);
}

export function isRightEdgeGridIndex(
  index: number,
  columns: number,
  itemCount: number,
): boolean {
  if (itemCount <= 0) return false;
  return index % columns === columns - 1 || index === itemCount - 1;
}

export function isLeftEdgeGridIndex(index: number, columns: number): boolean {
  return index % columns === 0;
}

export function clampGridFocusIndex(
  nextGlobalIndex: number,
  nextOffset: number,
  nextPageCount: number,
): number {
  if (nextPageCount <= 0) return 0;
  return Math.max(0, Math.min(nextGlobalIndex - nextOffset, nextPageCount - 1));
}

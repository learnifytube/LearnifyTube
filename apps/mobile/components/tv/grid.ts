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

/** Where the last page starts. The grid pages a whole page at a time, so cards never reflow. */
export function getLastPageOffset(itemCount: number, pageSize: number) {
  if (itemCount <= 0) return 0;
  return Math.floor((itemCount - 1) / pageSize) * pageSize;
}

/**
 * Right from the right column shows the next page, Left from the left column the previous
 * one, keeping focus on the same row. Null when the press stays on this page.
 */
export function turnGridPage({
  direction,
  focusedIndex,
  pageOffset,
  itemCount,
  columns,
  pageSize,
}: {
  direction: "left" | "right";
  focusedIndex: number;
  pageOffset: number;
  itemCount: number;
  columns: number;
  pageSize: number;
}) {
  const pageCount = Math.min(pageSize, itemCount - pageOffset);
  const row = Math.floor(focusedIndex / columns);

  if (direction === "right") {
    if (!isRightEdgeGridIndex(focusedIndex, columns, pageCount)) return null;
    const nextOffset = pageOffset + pageSize;
    if (nextOffset > getLastPageOffset(itemCount, pageSize)) return null;
    const nextCount = Math.min(pageSize, itemCount - nextOffset);
    return {
      pageOffset: nextOffset,
      focusedIndex: Math.min(row * columns, nextCount - 1),
    };
  }

  if (!isLeftEdgeGridIndex(focusedIndex, columns)) return null;
  const nextOffset = pageOffset - pageSize;
  if (nextOffset < 0) return null;
  return { pageOffset: nextOffset, focusedIndex: row * columns + columns - 1 };
}

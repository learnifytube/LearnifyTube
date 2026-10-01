import { getLastPageOffset, turnGridPage } from "./grid";

// 3 columns × 2 rows: a page of 6.
const grid = { columns: 3, pageSize: 6 };

describe("getLastPageOffset", () => {
  it("starts the last page on a whole page", () => {
    expect(getLastPageOffset(14, 6)).toBe(12);
    expect(getLastPageOffset(12, 6)).toBe(6);
    expect(getLastPageOffset(6, 6)).toBe(0);
    expect(getLastPageOffset(0, 6)).toBe(0);
  });
});

describe("turnGridPage", () => {
  it("turns to the next page from the right column, keeping the row", () => {
    expect(
      turnGridPage({
        ...grid,
        direction: "right",
        focusedIndex: 5,
        pageOffset: 0,
        itemCount: 14,
      }),
    ).toEqual({ pageOffset: 6, focusedIndex: 3 });
  });

  it("lands on the last card when the next page has no such row", () => {
    expect(
      turnGridPage({
        ...grid,
        direction: "right",
        focusedIndex: 5,
        pageOffset: 6,
        itemCount: 14,
      }),
    ).toEqual({ pageOffset: 12, focusedIndex: 1 });
  });

  it("turns back from the left column to the previous page's right column", () => {
    expect(
      turnGridPage({
        ...grid,
        direction: "left",
        focusedIndex: 3,
        pageOffset: 6,
        itemCount: 14,
      }),
    ).toEqual({ pageOffset: 0, focusedIndex: 5 });
  });

  it("stays put away from the edge, or with no page that way", () => {
    const at = (
      direction: "left" | "right",
      focusedIndex: number,
      pageOffset: number,
    ) =>
      turnGridPage({
        ...grid,
        direction,
        focusedIndex,
        pageOffset,
        itemCount: 14,
      });

    expect(at("right", 1, 0)).toBeNull();
    expect(at("left", 1, 6)).toBeNull();
    expect(at("left", 0, 0)).toBeNull();
    expect(at("right", 1, 12)).toBeNull();
  });

  it("treats the last card of a short page as the right edge", () => {
    expect(
      turnGridPage({
        ...grid,
        direction: "right",
        focusedIndex: 4,
        pageOffset: 0,
        itemCount: 5,
      }),
    ).toBeNull();
  });
});

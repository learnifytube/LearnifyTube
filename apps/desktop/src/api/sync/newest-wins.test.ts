import { newestWins } from "../../../../shared/newest-wins";

const change = (updatedAt: number, value = "a") => ({ value, updatedAt });

describe("Newest-wins merge", () => {
  it("takes the reported record when there is none yet", () => {
    expect(newestWins(null, change(10))).toEqual(change(10));
  });

  it("keeps the record there is when nothing is reported", () => {
    expect(newestWins(change(10), null)).toEqual(change(10));
  });

  it("is empty when neither side has a record", () => {
    expect(newestWins(null, null)).toBeNull();
  });

  it("takes a newer record", () => {
    expect(newestWins(change(10, "a"), change(20, "b"))).toEqual(change(20, "b"));
  });

  it("ignores a stale report", () => {
    expect(newestWins(change(20, "b"), change(10, "a"))).toEqual(change(20, "b"));
  });

  it("keeps the record there is when a report is as old as it", () => {
    expect(newestWins(change(20, "b"), change(20, "a"))).toEqual(change(20, "b"));
  });
});

import { newestListening } from "../../../../shared/listening-position";

const at = (updatedAt: number, trackId = "t1") => ({ trackId, seconds: 42, updatedAt });

describe("Listening position merge", () => {
  it("takes the reported position when there is none yet", () => {
    expect(newestListening(null, at(10))).toEqual(at(10));
  });

  it("keeps the position there is when nothing is reported", () => {
    expect(newestListening(at(10), null)).toEqual(at(10));
  });

  it("takes a newer position", () => {
    expect(newestListening(at(10, "t1"), at(20, "t3"))).toEqual(at(20, "t3"));
  });

  it("ignores a stale report", () => {
    expect(newestListening(at(20, "t3"), at(10, "t1"))).toEqual(at(20, "t3"));
  });

  it("keeps the position there is when a report is as old as it", () => {
    expect(newestListening(at(20, "t3"), at(20, "t1"))).toEqual(at(20, "t3"));
  });
});

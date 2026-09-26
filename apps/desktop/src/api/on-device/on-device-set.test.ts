import { computeOnDeviceSet, videosLeaving } from "./on-device-set";

const listItems = [
  { listId: "trip", videoId: "a" },
  { listId: "trip", videoId: "b" },
  { listId: "favorites", videoId: "b" },
  { listId: "favorites", videoId: "c" },
  { listId: "later", videoId: "d" },
];

describe("computeOnDeviceSet", () => {
  it("holds the Videos of every List switched on for devices", () => {
    const set = computeOnDeviceSet({
      switchedOnListIds: ["trip", "favorites"],
      listItems,
      phoneListVideoIds: [],
    });
    expect([...set].sort()).toEqual(["a", "b", "c"]);
  });

  it("always holds the Phone List", () => {
    const set = computeOnDeviceSet({
      switchedOnListIds: [],
      listItems,
      phoneListVideoIds: ["z"],
    });
    expect([...set]).toEqual(["z"]);
  });

  it("ignores Lists that are switched off", () => {
    const set = computeOnDeviceSet({
      switchedOnListIds: ["trip"],
      listItems,
      phoneListVideoIds: [],
    });
    expect(set.has("d")).toBe(false);
  });
});

describe("videosLeaving", () => {
  it("lists the Videos in the old set that the new set drops", () => {
    expect(videosLeaving(new Set(["a", "b", "c"]), new Set(["b"]))).toEqual(["a", "c"]);
  });

  it("does not count a Video still held through another List", () => {
    const before = computeOnDeviceSet({
      switchedOnListIds: ["trip", "favorites"],
      listItems,
      phoneListVideoIds: [],
    });
    const after = computeOnDeviceSet({
      switchedOnListIds: ["favorites"],
      listItems,
      phoneListVideoIds: [],
    });
    expect(videosLeaving(before, after)).toEqual(["a"]);
  });
});

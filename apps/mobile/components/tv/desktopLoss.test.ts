import { planDesktopLoss } from "./desktopLoss";

const queue = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const holds =
  (...ids: string[]) =>
  (videoId: string) =>
    ids.includes(videoId);

describe("planDesktopLoss", () => {
  it("switches to the Offline copy when the TV holds the Video", () => {
    expect(
      planDesktopLoss({
        videoId: "b",
        queue,
        index: 1,
        hasOfflineCopy: holds("b", "c"),
      }),
    ).toEqual({ kind: "offlineCopy" });
  });

  it("moves to the next Video in the queue the TV holds", () => {
    expect(
      planDesktopLoss({
        videoId: "a",
        queue,
        index: 0,
        hasOfflineCopy: holds("d"),
      }),
    ).toEqual({ kind: "next", index: 3 });
  });

  it("never moves back to an earlier Video in the queue", () => {
    expect(
      planDesktopLoss({
        videoId: "c",
        queue,
        index: 2,
        hasOfflineCopy: holds("a", "b"),
      }),
    ).toEqual({ kind: "back" });
  });

  it("goes back when nothing after the Video is held", () => {
    expect(
      planDesktopLoss({
        videoId: "d",
        queue,
        index: 3,
        hasOfflineCopy: holds(),
      }),
    ).toEqual({ kind: "back" });
  });

  it("goes back when the Video isn't played from a queue", () => {
    expect(
      planDesktopLoss({
        videoId: "x",
        queue,
        index: -1,
        hasOfflineCopy: holds("a"),
      }),
    ).toEqual({ kind: "back" });
  });
});

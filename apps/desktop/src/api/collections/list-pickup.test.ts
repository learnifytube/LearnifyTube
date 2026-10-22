import { whereListPicksUp, type PickUpVideo } from "../../../../shared/list-pickup";

const v = (id: string, watched = false, extra: Partial<PickUpVideo> = {}): PickUpVideo => ({
  id,
  watched,
  ...extra,
});

const pick = (videos: PickUpVideo[], currentVideoId: string | null) =>
  whereListPicksUp(videos, currentVideoId)?.id ?? null;

describe("where a List picks up", () => {
  it("resumes the Current Video while it isn't watched", () => {
    expect(pick([v("a"), v("b"), v("c")], "b")).toBe("b");
  });

  it("starts the next unwatched Video after a watched Current Video", () => {
    expect(pick([v("a"), v("b", true), v("c", true), v("d")], "b")).toBe("d");
  });

  it("starts the List from the top when nothing unwatched is left after the Current Video", () => {
    expect(pick([v("a", true), v("b"), v("c", true)], "c")).toBe("a");
  });

  it("starts the first unwatched Video when the Current Video has left the List", () => {
    expect(pick([v("a", true), v("b"), v("c")], "gone")).toBe("b");
  });

  it("starts the first unwatched Video when no Current Video is set", () => {
    expect(pick([v("a", true), v("b"), v("c")], null)).toBe("b");
  });

  it("starts from the top when every Video is watched and none is set", () => {
    expect(pick([v("a", true), v("b", true)], null)).toBe("a");
  });

  it("skips Videos that can't play", () => {
    expect(pick([v("a", true), v("b", false, { missing: true }), v("c")], "a")).toBe("c");
    expect(pick([v("a", false, { missing: true }), v("b")], "a")).toBe("b");
  });

  it("has nothing to play in an empty List", () => {
    expect(pick([], "a")).toBeNull();
  });
});

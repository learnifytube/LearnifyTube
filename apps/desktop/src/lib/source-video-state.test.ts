import {
  firstNotKeptVideoId,
  getSourceVideoState,
  type SourceVideoState,
} from "./source-video-state";

describe("getSourceVideoState", () => {
  it("is not kept when the Video is not in the Library", () => {
    expect(getSourceVideoState(undefined)).toBe("not-kept");
  });

  it("is keeping while the kept Video is on its way", () => {
    for (const downloadStatus of ["queued", "downloading", "paused"]) {
      expect(getSourceVideoState({ downloadStatus, watchState: "unwatched" })).toBe("keeping");
    }
  });

  it("is kept once fetched, whether unwatched or in progress", () => {
    expect(getSourceVideoState({ downloadStatus: "completed", watchState: "unwatched" })).toBe(
      "kept"
    );
    expect(getSourceVideoState({ downloadStatus: "completed", watchState: "in-progress" })).toBe(
      "kept"
    );
  });

  it("is watched once the kept Video is watched", () => {
    expect(getSourceVideoState({ downloadStatus: "completed", watchState: "watched" })).toBe(
      "watched"
    );
  });

  it("offers a Video whose fetch failed to be kept again", () => {
    expect(getSourceVideoState({ downloadStatus: "failed", watchState: "unwatched" })).toBe(
      "not-kept"
    );
  });
});

describe("firstNotKeptVideoId", () => {
  const stateOf = (states: Record<string, SourceVideoState>) => (videoId: string) =>
    states[videoId];

  it("is the first Video in page order not kept yet", () => {
    expect(
      firstNotKeptVideoId(
        ["a", "b", "c", "d"],
        stateOf({ a: "watched", b: "keeping", c: "not-kept", d: "not-kept" })
      )
    ).toBe("c");
  });

  it("is null when every Video is kept", () => {
    expect(firstNotKeptVideoId(["a", "b"], stateOf({ a: "kept", b: "watched" }))).toBeNull();
  });
});

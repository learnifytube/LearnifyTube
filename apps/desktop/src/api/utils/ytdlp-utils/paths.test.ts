import { thumbnailsDir } from "./thumbnails-dir";

describe("thumbnailsDir", () => {
  it("keeps files out of Chromium's Cache folder", () => {
    expect(thumbnailsDir("/tmp/LearnifyTube")).toBe("/tmp/LearnifyTube/thumbnails");
  });
});

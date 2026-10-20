import { localFirstCoverUri } from "./localFirstCoverUri";

const coverUrl = "http://desktop/api/audiobook/frankl/cover?v=1";

describe("localFirstCoverUri", () => {
  it("shows the cover stored on the phone, connected or not", () => {
    expect(
      localFirstCoverUri({
        heldCoverUri: "file://covers/frankl-1",
        serverUrl: "http://desktop",
        coverUrl,
      }),
    ).toBe("file://covers/frankl-1");
    expect(
      localFirstCoverUri({
        heldCoverUri: "file://covers/frankl-1",
        serverUrl: null,
        coverUrl,
      }),
    ).toBe("file://covers/frankl-1");
  });

  it("shows the desktop's cover when the phone stores none", () => {
    expect(
      localFirstCoverUri({
        heldCoverUri: null,
        serverUrl: "http://desktop",
        coverUrl,
      }),
    ).toBe(coverUrl);
  });

  it("shows no cover without one on the phone or a desktop", () => {
    expect(
      localFirstCoverUri({ heldCoverUri: null, serverUrl: null, coverUrl }),
    ).toBeNull();
    expect(
      localFirstCoverUri({
        heldCoverUri: null,
        serverUrl: "http://desktop",
        coverUrl: null,
      }),
    ).toBeNull();
  });
});

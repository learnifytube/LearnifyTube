import { resolveRemoteAssetUrl } from "./remoteAssetUrl";

describe("resolveRemoteAssetUrl", () => {
  it("rebuilds desktop /api/ assets on the connected desktop address", () => {
    expect(
      resolveRemoteAssetUrl(
        "http://10.0.2.2:53318",
        "http://192.168.1.20:53318/api/video/v1/thumbnail?token=VERFY234",
      ),
    ).toBe("http://10.0.2.2:53318/api/video/v1/thumbnail?token=VERFY234");
  });

  it("leaves YouTube URLs and joins relative desktop paths", () => {
    expect(
      resolveRemoteAssetUrl(
        "http://10.0.2.2:53318",
        "https://i.ytimg.com/vi/v1/hqdefault.jpg",
      ),
    ).toBe("https://i.ytimg.com/vi/v1/hqdefault.jpg");
    expect(
      resolveRemoteAssetUrl("http://10.0.2.2:53318", "/api/video/v1/thumbnail"),
    ).toBe("http://10.0.2.2:53318/api/video/v1/thumbnail");
  });
});

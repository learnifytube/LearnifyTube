import { act, renderHook } from "@testing-library/react-native";
import {
  createVideoThumbnails,
  type VideoThumbnailsPlatform,
} from "./createVideoThumbnails";

const SERVER = "http://desktop.local:53318";
const DIR = "file:///Documents/thumbnails";

function createHarness({ saved = [] as string[] } = {}) {
  const files = new Map<string, Uint8Array>(
    saved.map((name) => [`${DIR}/${name}`, new Uint8Array([0])]),
  );
  // What each URL answers with; anything missing fails like an HTTP 404.
  const web = new Map<string, { mimeType: string; bytes: Uint8Array }>();
  const requested: string[] = [];
  const pending = new Map<string, () => void>();
  const state = { failWrites: false, holdRequests: false };

  const platform: VideoThumbnailsPlatform = {
    list: () =>
      [...files.keys()].map((uri) => ({
        name: uri.slice(DIR.length + 1),
        uri,
      })),
    fetch: async (url) => {
      requested.push(url);
      if (state.holdRequests) {
        await new Promise<void>((resolve) => pending.set(url, resolve));
      }
      const answer = web.get(url);
      if (!answer) throw new Error("Thumbnail request failed with HTTP 404");
      return answer;
    },
    write: (name, bytes) => {
      if (state.failWrites) throw new Error("Disk full");
      const uri = `${DIR}/${name}`;
      files.set(uri, bytes);
      return uri;
    },
    delete: (uri) => {
      files.delete(uri);
    },
    desktopThumbnailUrl: (serverUrl, videoId) =>
      `${serverUrl}/api/video/${videoId}/thumbnail?token=t`,
    resolveUrl: (serverUrl, url) =>
      url.startsWith("/") ? `${serverUrl}${url}` : url,
  };

  return {
    thumbnails: createVideoThumbnails(platform),
    files,
    requested,
    state,
    serves: (url: string, mimeType = "image/jpeg") =>
      web.set(url, { mimeType, bytes: new Uint8Array([1, 2, 3]) }),
    release: (url: string) => pending.get(url)?.(),
  };
}

const desktopUrl = (videoId: string) =>
  `${SERVER}/api/video/${videoId}/thumbnail?token=t`;

describe("Video thumbnails", () => {
  it("finds thumbnails stored in earlier app runs", () => {
    const h = createHarness({ saved: ["v1.jpg", "v2.webp"] });

    expect(h.thumbnails.getUri("v1")).toBe(`${DIR}/v1.jpg`);
    expect(h.thumbnails.getUri("v2")).toBe(`${DIR}/v2.webp`);
    expect(h.thumbnails.getUri("v3")).toBeNull();
  });

  it("stores the desktop's thumbnail, named by its type", async () => {
    const h = createHarness();
    h.serves(desktopUrl("v1"), "image/webp");

    await h.thumbnails.store(SERVER, "v1", "https://i.ytimg.com/v1.jpg");

    expect(h.requested).toEqual([desktopUrl("v1")]);
    expect(h.thumbnails.getUri("v1")).toBe(`${DIR}/v1.webp`);
  });

  it("falls back to the Video's own thumbnail URL when the desktop has none", async () => {
    const h = createHarness();
    h.serves("https://i.ytimg.com/v1.jpg");

    await h.thumbnails.store(SERVER, "v1", "https://i.ytimg.com/v1.jpg");

    expect(h.requested).toEqual([desktopUrl("v1"), "https://i.ytimg.com/v1.jpg"]);
    expect(h.thumbnails.getUri("v1")).toBe(`${DIR}/v1.jpg`);
  });

  it("stores an inline thumbnail without asking anyone", async () => {
    const h = createHarness();
    const png = Buffer.from([137, 80, 78, 71]);

    await h.thumbnails.store(
      SERVER,
      "v1",
      `data:image/png;base64,${png.toString("base64")}`,
    );

    expect(h.requested).toEqual([]);
    expect(h.files.get(`${DIR}/v1.png`)).toEqual(new Uint8Array(png));
  });

  it("rejects when no source answers, storing nothing", async () => {
    const h = createHarness();

    await expect(
      h.thumbnails.store(SERVER, "v1", "https://i.ytimg.com/v1.jpg"),
    ).rejects.toThrow("HTTP 404");
    expect(h.thumbnails.getUri("v1")).toBeNull();
  });

  it("replaces a stored thumbnail, keeping the old one if writing fails", async () => {
    const h = createHarness({ saved: ["v1.jpg"] });
    h.serves(desktopUrl("v1"), "image/png");

    h.state.failWrites = true;
    await expect(h.thumbnails.store(SERVER, "v1", null)).rejects.toThrow(
      "Disk full",
    );
    expect(h.thumbnails.getUri("v1")).toBe(`${DIR}/v1.jpg`);
    expect(h.files.has(`${DIR}/v1.jpg`)).toBe(true);

    h.state.failWrites = false;
    await h.thumbnails.store(SERVER, "v1", null);
    expect(h.thumbnails.getUri("v1")).toBe(`${DIR}/v1.png`);
    expect([...h.files.keys()]).toEqual([`${DIR}/v1.png`]);
  });

  it("removes a stored thumbnail", () => {
    const h = createHarness({ saved: ["v1.jpg"] });

    h.thumbnails.remove("v1");

    expect(h.thumbnails.getUri("v1")).toBeNull();
    expect(h.files.size).toBe(0);
  });

  it("doesn't store a thumbnail for a Video removed while it was being fetched", async () => {
    const h = createHarness();
    h.serves(desktopUrl("v1"));
    h.state.holdRequests = true;

    const storing = h.thumbnails.store(SERVER, "v1", null);
    await Promise.resolve();
    h.thumbnails.remove("v1");
    h.release(desktopUrl("v1"));
    await storing;

    expect(h.thumbnails.getUri("v1")).toBeNull();
    expect(h.files.size).toBe(0);
  });

  it("re-renders screens as thumbnails are stored and removed", async () => {
    const h = createHarness();
    h.serves(desktopUrl("v1"));
    const { result } = await renderHook(() => h.thumbnails.useLookup());
    expect(result.current("v1")).toBeNull();

    await act(async () => {
      await h.thumbnails.store(SERVER, "v1", null);
    });
    expect(result.current("v1")).toBe(`${DIR}/v1.jpg`);

    await act(async () => {
      h.thumbnails.remove("v1");
    });
    expect(result.current("v1")).toBeNull();
  });
});

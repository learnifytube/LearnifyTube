import { createAudiobookCatalog } from "./createAudiobookCatalog";

const frankl = {
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverUrl: null,
  tracks: [
    { id: "t1", title: "Track 01", durationSeconds: 300, missing: false },
    { id: "t2", title: "Track 02", durationSeconds: null, missing: true },
  ],
  listeningPosition: null,
  finished: false,
  sentToDevices: false,
};

function createHarness({
  syncProtocolVersion = 3,
  payload = { audiobooks: [frankl] } as object,
} = {}) {
  const requested: string[] = [];
  const catalog = createAudiobookCatalog({
    getInfo: async () => ({ syncProtocolVersion }),
    getAudiobooks: async (serverUrl) => {
      requested.push(serverUrl);
      return payload;
    },
  });
  return { catalog, requested };
}

describe("Audiobook catalog", () => {
  it("lists the desktop's Audiobooks with their Tracks in order", async () => {
    const { catalog, requested } = createHarness();

    expect(await catalog.load("http://desktop")).toEqual([frankl]);
    expect(requested).toEqual(["http://desktop"]);
  });

  it("is empty on a desktop too old to serve Audiobooks, without asking it", async () => {
    const { catalog, requested } = createHarness({ syncProtocolVersion: 2 });

    expect(await catalog.load("http://desktop")).toEqual([]);
    expect(requested).toEqual([]);
  });

  it("tells a desktop too old to serve Audiobooks from one serving none", async () => {
    expect(
      await createHarness({ syncProtocolVersion: 2 }).catalog.served(
        "http://desktop",
      ),
    ).toBeNull();
    expect(
      await createHarness({ payload: { audiobooks: [] } }).catalog.served(
        "http://desktop",
      ),
    ).toEqual([]);
  });

  it("rejects a catalog that doesn't match the sync contract", async () => {
    const { catalog } = createHarness({
      payload: { audiobooks: [{ ...frankl, tracks: [{ id: "t1" }] }] },
    });

    await expect(catalog.load("http://desktop")).rejects.toThrow();
  });
});

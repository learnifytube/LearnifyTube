import type { MovieCatalog } from "../../../shared/mobile-sync-contract";
import { createMovieCatalog } from "./createMovieCatalog";

const up = {
  id: "up",
  title: "Up",
  posterUrl: "http://desktop/api/movie/up/poster?v=1&token=abc",
  durationSeconds: 5760,
  missing: false,
  captions: [],
  sentToDevices: false,
  watch: { positionSeconds: 600, watched: false, updatedAt: 2000 },
};

const office = {
  id: "office",
  title: "The Office",
  posterUrl: null,
  seasons: [
    {
      id: "s1",
      title: "Season 1",
      number: 1,
      sentToDevices: false,
      episodes: [
        {
          id: "e1",
          title: "Pilot",
          number: 1,
          durationSeconds: 1300,
          missing: false,
          captions: [],
          watch: null,
        },
      ],
    },
  ],
};

function createHarness({
  syncProtocolVersion = 4,
  payload = { movies: [up], series: [office] } as object,
} = {}) {
  const requested: string[] = [];
  const catalog = createMovieCatalog({
    getInfo: async () => ({ syncProtocolVersion }),
    getMovies: async (serverUrl) => {
      requested.push(serverUrl);
      return payload;
    },
  });
  return { catalog, requested };
}

const empty: MovieCatalog = { movies: [], series: [] };

describe("Movie catalog", () => {
  it("lists the desktop's Movies and Series", async () => {
    const { catalog, requested } = createHarness();

    expect(await catalog.load("http://desktop")).toEqual({
      movies: [up],
      series: [office],
    });
    expect(requested).toEqual(["http://desktop"]);
  });

  it("is empty on a desktop too old to serve Movies, without asking it", async () => {
    const { catalog, requested } = createHarness({ syncProtocolVersion: 3 });

    expect(await catalog.load("http://desktop")).toEqual(empty);
    expect(requested).toEqual([]);
  });

  it("tells a desktop too old to serve Movies from one serving none", async () => {
    expect(
      await createHarness({ syncProtocolVersion: 3 }).catalog.served(
        "http://desktop",
      ),
    ).toBeNull();
    expect(
      await createHarness({ payload: empty }).catalog.served("http://desktop"),
    ).toEqual(empty);
  });

  it("rejects a catalog that doesn't match the sync contract", async () => {
    const { catalog } = createHarness({
      payload: {
        movies: [{ ...up, watch: { positionSeconds: 1 } }],
        series: [],
      },
    });

    await expect(catalog.load("http://desktop")).rejects.toThrow();
  });
});

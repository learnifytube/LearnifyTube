import type { Episode, Series } from "../../../shared/mobile-sync-contract";
import { phoneSeriesDownload, phoneSeriesView } from "./phoneSeries";

const episode = (id: string, missing = false): Episode => ({
  id,
  title: id,
  number: null,
  durationSeconds: 1000,
  missing,
  captions: [],
  watch: null,
});

const office: Series = {
  id: "office",
  title: "The Office",
  posterUrl: null,
  seasons: [
    {
      id: "s1",
      title: "Season 1",
      number: 1,
      sentToDevices: true,
      episodes: [episode("e1"), episode("e2"), episode("e3")],
    },
    {
      id: "s2",
      title: "Season 2",
      number: 2,
      sentToDevices: false,
      episodes: [episode("e4")],
    },
  ],
};

const episodeIds = (view: ReturnType<typeof phoneSeriesView>) =>
  view.kind === "ready"
    ? view.series.seasons.map((season) =>
        season.episodes.map((item) => item.id),
      )
    : view.kind;

describe("Phone Series screen", () => {
  it("shows every Episode while connected", () => {
    expect(
      episodeIds(
        phoneSeriesView({
          series: office,
          connected: true,
          isHeld: (id) => id === "e1",
        }),
      ),
    ).toEqual([["e1", "e2", "e3"], ["e4"]]);
  });

  it("in Offline mode shows the Episodes this phone holds", () => {
    expect(
      episodeIds(
        phoneSeriesView({
          series: office,
          connected: false,
          isHeld: (id) => id === "e1" || id === "e2",
        }),
      ),
    ).toEqual([["e1", "e2"]]);
  });

  it("in Offline mode plays a held Episode the desktop lost", () => {
    const lost: Series = {
      ...office,
      seasons: [{ ...office.seasons[0], episodes: [episode("e1", true)] }],
    };
    const view = phoneSeriesView({
      series: lost,
      connected: false,
      isHeld: (id) => id === "e1",
    });
    expect(view.kind).toBe("ready");
    expect(
      view.kind === "ready" && view.series.seasons[0].episodes[0].missing,
    ).toBe(false);
  });

  it("in Offline mode Needs the desktop when no Episode is on this phone", () => {
    expect(
      phoneSeriesView({ series: office, connected: false, isHeld: () => false })
        .kind,
    ).toBe("needsDesktop");
  });

  it("isn't available when the catalog doesn't list it", () => {
    expect(
      phoneSeriesView({
        series: undefined,
        connected: true,
        isHeld: () => true,
      }).kind,
    ).toBe("notFound");
  });
});

describe("Phone Series Download to this phone", () => {
  const withMissing: Series = {
    ...office,
    seasons: [
      ...office.seasons,
      {
        id: "s3",
        title: "Season 3",
        number: 3,
        sentToDevices: false,
        episodes: [episode("e5", true)],
      },
    ],
  };
  const ids = (download: ReturnType<typeof phoneSeriesDownload>) =>
    download.toPull.map((item) => item.id);

  it("pulls every Episode that isn't missing", () => {
    const download = phoneSeriesDownload({
      series: withMissing,
      holds: [],
      hasCopy: () => false,
    });
    expect(ids(download)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(download).toMatchObject({ total: 4, onPhone: 0, status: null });
  });

  it("leaves out Episodes already pulled, and keeps the ones the desktop sent", () => {
    const download = phoneSeriesDownload({
      series: withMissing,
      holds: [
        { id: "e1", reasons: ["pulled"] },
        { id: "e2", reasons: ["mirrored"] },
      ],
      hasCopy: (id) => id === "e1" || id === "e2",
    });
    expect(ids(download)).toEqual(["e2", "e3", "e4"]);
    expect(download).toMatchObject({
      total: 4,
      onPhone: 2,
      status: "2 of 4 on this phone",
    });
  });

  it("has nothing to pull once every Episode is pulled", () => {
    const download = phoneSeriesDownload({
      series: withMissing,
      holds: ["e1", "e2", "e3", "e4"].map((id) => ({
        id,
        reasons: ["pulled" as const],
      })),
      hasCopy: (id) => id !== "e4",
    });
    expect(ids(download)).toEqual([]);
    expect(download).toMatchObject({
      total: 4,
      onPhone: 3,
      status: "Downloading · 3 of 4 on this phone",
    });
  });

  it("says On this phone once every Episode has arrived", () => {
    const download = phoneSeriesDownload({
      series: office,
      holds: [],
      hasCopy: () => true,
    });
    expect(download.status).toBe("On this phone");
  });
});

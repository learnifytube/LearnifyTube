import type { Episode, Series } from "../../../shared/mobile-sync-contract";
import { phoneSeriesView } from "./phoneSeries";

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

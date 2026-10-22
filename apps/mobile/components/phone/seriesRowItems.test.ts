import type { Episode, Series } from "../../../shared/mobile-sync-contract";
import { seriesRowItems } from "./seriesRowItems";

const episode = (id: string, missing = false): Episode => ({
  id,
  title: id,
  number: null,
  durationSeconds: 1000,
  missing,
  captions: [],
  watch: null,
});

const series = (id: string, episodes: Episode[]): Series => ({
  id,
  title: id,
  posterUrl: null,
  seasons: [
    {
      id: `${id}-s1`,
      title: "Season 1",
      number: 1,
      sentToDevices: false,
      episodes,
    },
  ],
});

describe("Series row", () => {
  it("shows the desktop's Series in its order", () => {
    expect(
      seriesRowItems({
        connected: true,
        series: [
          series("office", [episode("o1")]),
          series("lost", [episode("l1")]),
        ],
      }).map((item) => [item.series.id, item.needsDesktop]),
    ).toEqual([
      ["office", false],
      ["lost", false],
    ]);
  });

  it("leaves out a Series with no Episode that can play", () => {
    expect(
      seriesRowItems({
        connected: true,
        series: [series("office", [episode("o1", true)]), series("lost", [])],
      }),
    ).toEqual([]);
  });

  it("dims a Series in Offline mode when none of its Episodes is on this phone", () => {
    expect(
      seriesRowItems({
        connected: false,
        series: [series("office", [episode("o1")])],
      })[0].needsDesktop,
    ).toBe(true);
  });

  it("keeps a Series playable in Offline mode while an Episode is on this phone", () => {
    expect(
      seriesRowItems({
        connected: false,
        series: [series("office", [episode("o1"), episode("o2")])],
        onThisPhone: (id) => id === "o2",
      })[0].needsDesktop,
    ).toBe(false);
  });
});

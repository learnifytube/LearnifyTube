import type { FolderListing } from "@/api/audiobooks/import-plan";
import { planSeriesImport, reorderSeries, suggestVideoLayout } from "./series-plan";

const files = (...paths: string[]): FolderListing["files"] => paths.map((path) => ({ path }));

const outline = (listing: FolderListing): [string, string[]][] =>
  planSeriesImport(listing).seasons.map((season) => [
    season.title,
    season.episodes.map((episode) => episode.path),
  ]);

const S1E01 = "Season 1/The.Office.S01E01.mkv";
const S1E02 = "Season 1/The.Office.S01E02.mkv";
const S2E02 = "Season 2/The.Office.S02E02.mkv";
const S2E10 = "Season 2/The.Office.S02E10.mkv";

// A downloaded show:SxxEyy names, in Season folders that disagree with nothing.
const office: FolderListing = {
  name: "The Office (US)",
  files: [
    { path: "poster.jpg" },
    { path: S2E10, durationSeconds: 1320, videoCodec: "h264" },
    { path: S2E02 },
    { path: S1E02 },
    { path: S1E01 },
    { path: "Season 1/Sample/The.Office.S01E01.sample.mkv" },
    { path: "Season 1/The.Office.S01E01.srt" },
  ],
};

describe("planSeriesImport", () => {
  it("orders Episodes by the SxxEyy numbers in their names, Season by Season", () => {
    const plan = planSeriesImport(office);
    expect(plan.title).toBe("The Office (US)");
    expect(plan.poster).toEqual({ kind: "file", path: "poster.jpg" });
    expect(outline(office)).toEqual([
      ["Season 1", [S1E01, S1E02]],
      ["Season 2", [S2E02, S2E10]],
    ]);
    expect(plan.seasons[1]).toMatchObject({ number: 2 });
    expect(plan.seasons[1].episodes[1]).toEqual({
      path: S2E10,
      title: "The.Office.S02E10",
      number: 10,
      durationSeconds: 1320,
      videoCodec: "h264",
      audioCodec: null,
      codecWarnings: [],
    });
  });

  it("goes by SxxEyy over the folder a file sits in, and reads 1x02 too", () => {
    const listing: FolderListing = {
      name: "Show",
      files: files("misc/show.s02e01.mp4", "show 1x02.mp4", "Show.S01E01.mp4"),
    };
    expect(outline(listing)).toEqual([
      ["Season 1", ["Show.S01E01.mp4", "show 1x02.mp4"]],
      ["Season 2", ["misc/show.s02e01.mp4"]],
    ]);
  });

  it("makes flat numbered files one Season, in natural file-name order", () => {
    const listing: FolderListing = {
      name: "Planet Earth",
      files: files("Episode 10.mkv", "Episode 2.mkv", "Episode 1.mkv", "cover.jpg"),
    };
    const plan = planSeriesImport(listing);
    expect(outline(listing)).toEqual([
      ["Season 1", ["Episode 1.mkv", "Episode 2.mkv", "Episode 10.mkv"]],
    ]);
    expect(plan.seasons[0].number).toBe(1);
    expect(plan.poster).toEqual({ kind: "file", path: "cover.jpg" });
  });

  it("makes Season folders Seasons, in number order, and Episodes in natural order", () => {
    const listing: FolderListing = {
      name: "Cosmos",
      files: files(
        "Season 10/Part 1.mp4",
        "Season 2/Part 10.mp4",
        "Season 2/Part 9.mp4",
        "S01/a.mp4",
        "Specials/Making of.mp4"
      ),
    };
    expect(outline(listing)).toEqual([
      ["Season 1", ["S01/a.mp4"]],
      ["Season 2", ["Season 2/Part 9.mp4", "Season 2/Part 10.mp4"]],
      ["Season 10", ["Season 10/Part 1.mp4"]],
      ["Specials", ["Specials/Making of.mp4"]],
    ]);
  });

  it("keeps other subfolders as Seasons named after them, after the numbered ones", () => {
    const listing: FolderListing = {
      name: "Docs",
      files: files("Part B/2.mp4", "Part A/1.mp4", "Season 1/x.mp4", "loose.mp4"),
    };
    expect(outline(listing)).toEqual([
      ["Season 1", ["Season 1/x.mp4"]],
      ["Episodes", ["loose.mp4"]],
      ["Part A", ["Part A/1.mp4"]],
      ["Part B", ["Part B/2.mp4"]],
    ]);
  });

  it("falls back to the first Episode's embedded art, then a frame of it, for the poster", () => {
    expect(
      planSeriesImport({
        name: "S",
        files: [{ path: "S01E02.mkv" }, { path: "S01E01.mkv", attachedPicStream: 3 }],
      }).poster
    ).toEqual({ kind: "embedded", videoPath: "S01E01.mkv", stream: 3 });
    expect(planSeriesImport({ name: "S", files: files("S01E01.mkv") }).poster).toEqual({
      kind: "frame",
      videoPath: "S01E01.mkv",
    });
  });

  it("warns about Episodes Android is likely to refuse to play", () => {
    const [season] = planSeriesImport({
      name: "Old",
      files: [
        { path: "S01E01.avi", videoCodec: "mpeg4", audioCodec: "dts" },
        { path: "S01E02.mkv", videoCodec: "h264", audioCodec: "aac" },
      ],
    }).seasons;
    expect(season.episodes.map((episode) => episode.codecWarnings)).toEqual([
      [
        { part: "container", name: "AVI" },
        { part: "audio", name: "DTS" },
      ],
      [],
    ]);
  });

  it("proposes no Seasons for a folder without video", () => {
    expect(planSeriesImport({ name: "book", files: files("1.mp3") }).seasons).toEqual([]);
  });
});

describe("reorderSeries", () => {
  const plan = planSeriesImport(office);
  const [s1, s2] = plan.seasons;

  it("applies the user's Season and Episode order, moving Episodes between Seasons", () => {
    const fixed = reorderSeries(plan, [
      { key: s2.key, episodes: [S2E10] },
      {
        key: s1.key,
        episodes: [S2E02, S1E02, S1E01],
      },
    ]);
    expect(
      fixed.seasons.map((season) => [season.title, season.episodes.map((e) => e.path)])
    ).toEqual([
      ["Season 2", [S2E10]],
      ["Season 1", [S2E02, S1E02, S1E01]],
    ]);
  });

  it("ignores files it didn't plan, and keeps planned ones the order left out", () => {
    const fixed = reorderSeries(plan, [
      { key: s1.key, episodes: ["/etc/passwd", S1E02] },
      { key: "nope", episodes: [S1E01] },
    ]);
    expect(
      fixed.seasons.map((season) => [season.title, season.episodes.map((e) => e.path)])
    ).toEqual([
      ["Season 1", [S1E02, S1E01]],
      ["Season 2", [S2E02, S2E10]],
    ]);
  });

  it("drops Seasons the user emptied", () => {
    const fixed = reorderSeries(plan, [
      { key: s1.key, episodes: [...s1.episodes, ...s2.episodes].map((e) => e.path) },
      { key: s2.key, episodes: [] },
    ]);
    expect(fixed.seasons.map((season) => season.title)).toEqual(["Season 1"]);
  });
});

describe("suggestVideoLayout", () => {
  it("suggests a Series for SxxEyy names, Season folders or flat numbered Episodes", () => {
    expect(suggestVideoLayout(office)).toBe("series");
    expect(
      suggestVideoLayout({ name: "C", files: files("Season 1/a.mp4", "Season 2/b.mp4") })
    ).toBe("series");
    expect(suggestVideoLayout({ name: "P", files: files("Episode 1.mkv", "Episode 2.mkv") })).toBe(
      "series"
    );
  });

  it("suggests Movies for a film's folder or a collection of films", () => {
    expect(suggestVideoLayout({ name: "Up", files: files("Up.mkv", "Sample/sample.mkv") })).toBe(
      "one-movie"
    );
    expect(
      suggestVideoLayout({ name: "Films", files: files("Up (2009).mp4", "Alien (1979).mkv") })
    ).toBe("movie-per-file");
  });
});

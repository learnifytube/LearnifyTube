import type { FolderListing } from "@/api/audiobooks/import-plan";
import { planSeriesRescan, type CurrentSeason } from "./series-rescan-plan";

const listing = (...paths: string[]): FolderListing => ({
  name: "The Office",
  files: paths.map((path) => ({ path, durationSeconds: 1300, videoCodec: "h264" })),
});

const season = (
  id: string,
  title: string,
  number: number | null,
  episodes: [id: string, path: string, number: number | null][]
): CurrentSeason => ({
  id,
  title,
  number,
  episodes: episodes.map(([episodeId, path, episodeNumber]) => ({
    id: episodeId,
    path,
    number: episodeNumber,
    missing: false,
  })),
});

// Each Season as its title and Episodes: an id for those already there, the path for new ones.
const outline = (plan: ReturnType<typeof planSeriesRescan>): unknown =>
  plan.seasons.map((s) => [
    s.kind === "existing" ? s.id : `new ${s.title}`,
    s.episodes.map((e) =>
      e.kind === "existing" ? (e.missing ? `${e.id} (missing)` : e.id) : e.episode.path
    ),
  ]);

const E01 = "S01E01.mkv";
const E02 = "S01E02.mkv";

describe("planSeriesRescan", () => {
  it("adds a newly downloaded Episode to the end of its Season", () => {
    const current = [
      season("s1", "Season 1", 1, [
        ["e1", "Season 1/S01E01.mkv", 1],
        ["e2", "Season 1/S01E02.mkv", 2],
      ]),
    ];
    const plan = planSeriesRescan(
      current,
      listing("Season 1/S01E01.mkv", "Season 1/S01E02.mkv", "Season 1/S01E03.mkv", "poster.jpg")
    );
    expect(outline(plan)).toEqual([["s1", ["e1", "e2", "Season 1/S01E03.mkv"]]]);
    expect(plan.added).toBe(1);
    expect(plan.seasons[0].episodes[2]).toMatchObject({
      kind: "new",
      episode: { title: "S01E03", number: 3, durationSeconds: 1300, videoCodec: "h264" },
    });
  });

  it("marks Episodes whose file is gone as missing, and restores them when it is back", () => {
    const current = [
      season("s1", "Season 1", 1, [
        ["e1", E01, 1],
        ["e2", E02, 2],
      ]),
    ];
    const gone = planSeriesRescan(current, listing(E01));
    expect(outline(gone)).toEqual([["s1", ["e1", "e2 (missing)"]]]);
    expect(gone).toMatchObject({ added: 0, missing: 1 });

    current[0].episodes[1].missing = true;
    expect(outline(planSeriesRescan(current, listing(E01, E02)))).toEqual([["s1", ["e1", "e2"]]]);
  });

  it("marks every Episode missing when the Series folder is gone", () => {
    const current = [season("s1", "Season 1", 1, [["e1", E01, 1]])];
    expect(outline(planSeriesRescan(current, listing()))).toEqual([["s1", ["e1 (missing)"]]]);
  });

  it("puts a new Episode in its place by number without reordering those already there", () => {
    // The user had put E04 before E02 in the preview.
    const current = [
      season("s1", "Season 1", 1, [
        ["e1", E01, 1],
        ["e4", "S01E04.mkv", 4],
        ["e2", E02, 2],
      ]),
    ];
    const plan = planSeriesRescan(
      current,
      listing(E01, E02, "S01E03.mkv", "S01E04.mkv", "S01E00.mkv")
    );
    expect(outline(plan)).toEqual([["s1", ["S01E00.mkv", "e1", "e4", "e2", "S01E03.mkv"]]]);
  });

  it("starts a new Season for a new Season folder, after those already there", () => {
    const current = [
      season("s1", "Season 1", 1, [["e1", "Season 1/S01E01.mkv", 1]]),
      season("w", "Webisodes", null, [["w1", "Webisodes/Part 1.mkv", null]]),
    ];
    const plan = planSeriesRescan(
      current,
      listing(
        "Season 1/S01E01.mkv",
        "Season 2/S02E02.mkv",
        "Season 2/S02E01.mkv",
        "Webisodes/Part 1.mkv",
        "Webisodes/Part 2.mkv"
      )
    );
    expect(outline(plan)).toEqual([
      ["s1", ["e1"]],
      ["w", ["w1", "Webisodes/Part 2.mkv"]],
      ["new Season 2", ["Season 2/S02E01.mkv", "Season 2/S02E02.mkv"]],
    ]);
    expect(plan.seasons[2]).toMatchObject({ kind: "new", number: 2 });
    expect(plan.added).toBe(3);
  });

  it("adds a file to the Season holding its folder, as the user arranged it in the preview", () => {
    // The user moved the Pilot folder's Episode into Season 1 when importing.
    const current = [
      season("s1", "Season 1", 1, [
        ["p", "Pilot/Pilot.mkv", null],
        ["e1", E01, 1],
      ]),
    ];
    const plan = planSeriesRescan(
      current,
      listing("Pilot/Pilot.mkv", "Pilot/Unaired Pilot.mkv", E01)
    );
    expect(outline(plan)).toEqual([["s1", ["p", "e1", "Pilot/Unaired Pilot.mkv"]]]);
  });
});

import { planRescan, type CurrentTrack } from "./rescan-plan";
import type { FolderListing } from "./import-plan";

const listing = (...paths: string[]): FolderListing => ({
  name: "Orwell",
  files: paths.map((path) => ({ path, durationSeconds: 60 })),
});

const track = (id: string, path: string, missing = false): CurrentTrack => ({ id, path, missing });

// Orwell after the user moved the Stephen Fry intro before the book.
const reorderedOrwell = [
  track("intro", "Stephen Fry Intro.mp3"),
  track("book", "Animal Farm Audiobook.mp3"),
];

describe("planRescan", () => {
  it("appends new files at the end of the Track order", () => {
    const plan = planRescan(
      reorderedOrwell,
      listing(
        "Animal Farm Audiobook.mp3",
        "1984 Audiobook.mp3",
        "Stephen Fry Intro.mp3",
        "orwl.jpg"
      )
    );
    expect(plan.tracks).toEqual([
      { kind: "existing", id: "intro", missing: false },
      { kind: "existing", id: "book", missing: false },
      { kind: "new", path: "1984 Audiobook.mp3", durationSeconds: 60 },
    ]);
  });

  it("marks a file that is gone as missing and keeps its place", () => {
    const plan = planRescan(reorderedOrwell, listing("Animal Farm Audiobook.mp3"));
    expect(plan.tracks).toEqual([
      { kind: "existing", id: "intro", missing: true },
      { kind: "existing", id: "book", missing: false },
    ]);
  });

  it("clears missing when the file comes back", () => {
    const plan = planRescan(
      [track("intro", "Stephen Fry Intro.mp3", true), track("book", "Animal Farm Audiobook.mp3")],
      listing("Animal Farm Audiobook.mp3", "Stephen Fry Intro.mp3")
    );
    expect(plan.tracks).toEqual([
      { kind: "existing", id: "intro", missing: false },
      { kind: "existing", id: "book", missing: false },
    ]);
  });

  it("never reorders a book the user reordered", () => {
    const plan = planRescan(
      [track("t10", "CD 1/Track 10.mp3"), track("t2", "CD 1/Track 2.mp3")],
      listing("CD 1/Track 2.mp3", "CD 1/Track 10.mp3")
    );
    expect(plan.tracks.map((t) => (t.kind === "existing" ? t.id : t.path))).toEqual(["t10", "t2"]);
  });

  it("orders several new files by subfolder then number", () => {
    const plan = planRescan(
      [track("t1", "CD 1/Track 1.mp3")],
      listing("CD 2/Track 10.mp3", "CD 1/Track 1.mp3", "CD 2/Track 2.mp3", "cover.jpg")
    );
    expect(plan.tracks.map((t) => (t.kind === "existing" ? t.id : t.path))).toEqual([
      "t1",
      "CD 2/Track 2.mp3",
      "CD 2/Track 10.mp3",
    ]);
  });
});

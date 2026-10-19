import { planImport, type FolderListing } from "./import-plan";

const audio = (path: string, extra: Partial<FolderListing["files"][number]> = {}) => ({
  path,
  ...extra,
});

const eightMinutes: FolderListing = {
  name: "8phutthien",
  files: [
    "MucLuc.mp3",
    "Phan2-4.mp3",
    "Phan2-1.mp3",
    "Phan2-2.mp3",
    "Phan2-3.mp3",
    "MoDau.mp3",
    "Phan3-2.mp3",
    "Phan1-1.mp3",
    "Phan3-1.mp3",
    "Phan1-2.mp3",
  ].map((path) => audio(path)),
};

const orwell: FolderListing = {
  name: "George Orwell - Orwell Collection Animal Farm  1984",
  files: [
    { path: "orwl.jpg" },
    audio("George Orwell Collection - Animal Farm Audiobook.mp3"),
    audio("George Orwell Collection - Stephen Fry Intro.mp3"),
  ],
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const pad = (n: number) => String(n).padStart(2, "0");

// CD 1, CD 2 and CD 4 number their files "Track 01"; CD 3 numbers them "Track 1".
const franklDiscs = [
  ...range(1, 14).map((n) => `CD 1/Track ${pad(n)}.mp3`),
  ...range(1, 11).map((n) => `CD 2/Track ${pad(n)}.mp3`),
  ...range(1, 9).map((n) => `CD 3/Track ${n}.mp3`),
  ...range(1, 11).map((n) => `CD 4/Track ${pad(n)}.mp3`),
];

const frankl: FolderListing = {
  name: "Viktor E. Frankl-Man's Search for Ultimate Meaning",
  files: [".DS_Store", ...[...franklDiscs].reverse()].map((path) => audio(path)),
};

const inside = (folder: FolderListing) =>
  folder.files.map((file) => ({ ...file, path: `${folder.name}/${file.path}` }));

const audiobooks: FolderListing = {
  name: "audiobooks",
  files: [{ path: ".DS_Store" }, ...inside(frankl), ...inside(eightMinutes), ...inside(orwell)],
};

const trackPaths = (book: { tracks: { path: string }[] }) => book.tracks.map((t) => t.path);

describe("planImport", () => {
  it("makes a flat folder of audio one Audiobook in file-name order", () => {
    const plan = planImport(eightMinutes);
    expect(plan.suggestedMode).toBe("one-book");
    expect(plan.books).toHaveLength(1);
    expect(plan.books[0].title).toBe("8phutthien");
    expect(trackPaths(plan.books[0])).toEqual([
      "MoDau.mp3",
      "MucLuc.mp3",
      "Phan1-1.mp3",
      "Phan1-2.mp3",
      "Phan2-1.mp3",
      "Phan2-2.mp3",
      "Phan2-3.mp3",
      "Phan2-4.mp3",
      "Phan3-1.mp3",
      "Phan3-2.mp3",
    ]);
  });

  it("takes the cover from an image in the folder", () => {
    const plan = planImport(orwell);
    expect(plan.books).toHaveLength(1);
    expect(plan.books[0].cover).toEqual({ kind: "file", path: "orwl.jpg" });
    expect(trackPaths(plan.books[0])).toEqual([
      "George Orwell Collection - Animal Farm Audiobook.mp3",
      "George Orwell Collection - Stephen Fry Intro.mp3",
    ]);
  });

  it("keeps a book split into CD subfolders as one Audiobook, disc by disc", () => {
    const plan = planImport(frankl);
    expect(plan.suggestedMode).toBe("one-book");
    expect(plan.books).toHaveLength(1);
    expect(plan.books[0].title).toBe("Viktor E. Frankl-Man's Search for Ultimate Meaning");
    expect(trackPaths(plan.books[0])).toEqual(franklDiscs);
  });

  it("makes each subfolder of a collection one Audiobook", () => {
    const plan = planImport(audiobooks);
    expect(plan.suggestedMode).toBe("each-subfolder");
    expect(plan.books.map((book) => book.title)).toEqual([
      "8phutthien",
      "George Orwell - Orwell Collection Animal Farm  1984",
      "Viktor E. Frankl-Man's Search for Ultimate Meaning",
    ]);
    expect(plan.books[1].cover).toEqual({
      kind: "file",
      path: "George Orwell - Orwell Collection Animal Farm  1984/orwl.jpg",
    });
    expect(trackPaths(plan.books[2])).toEqual(
      franklDiscs.map((path) => `Viktor E. Frankl-Man's Search for Ultimate Meaning/${path}`)
    );
  });

  it("lets the user flip a disc-split book into one Audiobook per subfolder", () => {
    const plan = planImport(frankl, "each-subfolder");
    expect(plan.suggestedMode).toBe("one-book");
    expect(plan.books.map((book) => [book.folder, book.title, book.tracks.length])).toEqual([
      ["CD 1", "CD 1", 14],
      ["CD 2", "CD 2", 11],
      ["CD 3", "CD 3", 9],
      ["CD 4", "CD 4", 11],
    ]);
  });

  it("lets the user flip a collection into one Audiobook", () => {
    const plan = planImport(audiobooks, "one-book");
    expect(plan.suggestedMode).toBe("each-subfolder");
    expect(plan.books).toHaveLength(1);
    expect(plan.books[0]).toMatchObject({ folder: "", title: "audiobooks" });
    expect(plan.books[0].tracks).toHaveLength(10 + 2 + 45);
    expect(plan.books[0].tracks[0].path).toBe("8phutthien/MoDau.mp3");
  });

  it("fills the author from the artist tag only when every Track agrees", () => {
    const tagged = (artists: (string | null)[]) =>
      planImport({
        name: "book",
        files: artists.map((artist, i) => audio(`${i + 1}.mp3`, { artist })),
      }).books[0].author;
    expect(tagged(["Viktor Frankl", "Viktor Frankl"])).toBe("Viktor Frankl");
    expect(tagged(["Viktor Frankl", "Someone Else"])).toBeNull();
    expect(tagged(["Viktor Frankl", null])).toBeNull();
    expect(tagged([null, null])).toBeNull();
  });

  it("falls back to the first Track's embedded art, then a placeholder", () => {
    const withArt = planImport({
      name: "book",
      files: [audio("2.m4b", { hasEmbeddedArt: true }), audio("1.m4b", { hasEmbeddedArt: true })],
    });
    expect(withArt.books[0].cover).toEqual({ kind: "embedded", trackPath: "1.m4b" });

    const firstHasNone = planImport({
      name: "book",
      files: [audio("1.mp3"), audio("2.mp3", { hasEmbeddedArt: true })],
    });
    expect(firstHasNone.books[0].cover).toEqual({ kind: "placeholder" });
  });

  it("ignores files that are not audio", () => {
    const plan = planImport({
      name: "book",
      files: ["notes.txt", "1.flac", "2.ogg", "3.opus", "4.aac", "5.m4a", "video.mp4"].map((path) =>
        audio(path)
      ),
    });
    expect(trackPaths(plan.books[0])).toEqual(["1.flac", "2.ogg", "3.opus", "4.aac", "5.m4a"]);
  });

  it("proposes nothing for a folder without audio", () => {
    expect(planImport({ name: "photos", files: [{ path: "a.jpg" }] }).books).toEqual([]);
  });
});

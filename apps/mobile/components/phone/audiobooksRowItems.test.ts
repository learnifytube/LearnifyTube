import type { Book } from "../../services/book-player/createBookPlayer";
import type { Hold } from "../../services/held-audiobooks/createHeldAudiobooks";
import { audiobooksRowItems } from "./audiobooksRowItems";

const book = (id: string): Book => ({
  id,
  title: id,
  author: null,
  coverUrl: null,
  tracks: [{ id: `${id}-1`, title: "1", durationSeconds: 60, missing: false }],
});

const hold = (b: Book, complete: boolean): Hold => ({
  book: b,
  reasons: ["pulled"],
  heldTracks: complete ? 1 : 0,
  totalTracks: 1,
  complete,
});

const frankl = book("frankl");
const orwell = book("orwell");
const flat = book("8phutthien");

describe("Audiobooks row", () => {
  it("lists the desktop's books while connected, marking those held on this phone", () => {
    const items = audiobooksRowItems({
      connected: true,
      catalog: [frankl, orwell, flat],
      holds: new Map([
        ["frankl", hold(frankl, true)],
        ["orwell", hold(orwell, false)],
      ]),
    });

    expect(items).toEqual([
      { book: frankl, onThisPhone: true, needsDesktop: false },
      { book: orwell, onThisPhone: false, needsDesktop: false },
      { book: flat, onThisPhone: false, needsDesktop: false },
    ]);
  });

  it("keeps a held book the desktop no longer has", () => {
    const items = audiobooksRowItems({
      connected: true,
      catalog: [orwell],
      holds: new Map([["frankl", hold(frankl, true)]]),
    });

    expect(items.map((item) => item.book.id)).toEqual(["orwell", "frankl"]);
  });

  it("in Offline mode, held books play and the rest need the desktop", () => {
    const items = audiobooksRowItems({
      connected: false,
      catalog: [frankl, orwell, flat],
      holds: new Map([
        ["frankl", hold(frankl, true)],
        ["orwell", hold(orwell, false)],
      ]),
    });

    expect(items).toEqual([
      { book: frankl, onThisPhone: true, needsDesktop: false },
      { book: orwell, onThisPhone: false, needsDesktop: true },
      { book: flat, onThisPhone: false, needsDesktop: true },
    ]);
  });

  it("in Offline mode with no catalog yet, shows the books held on this phone", () => {
    const items = audiobooksRowItems({
      connected: false,
      catalog: null,
      holds: new Map([["frankl", hold(frankl, true)]]),
    });

    expect(items).toEqual([
      { book: frankl, onThisPhone: true, needsDesktop: false },
    ]);
  });
});

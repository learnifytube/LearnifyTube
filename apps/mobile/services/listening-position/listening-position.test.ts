import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { continueListening, resumePoint } from "./listeningPosition";

const book = (id: string, overrides: Partial<Audiobook> = {}): Audiobook => ({
  id,
  title: id,
  author: null,
  coverUrl: null,
  tracks: [
    { id: `${id}-1`, title: "1", durationSeconds: 300, missing: false },
    { id: `${id}-2`, title: "2", durationSeconds: 300, missing: false },
  ],
  listeningPosition: null,
  finished: false,
  sentToDevices: false,
  ...overrides,
});

const kept = (
  audiobookId: string,
  updatedAt: number,
  overrides: { trackId?: string; seconds?: number; finished?: boolean } = {},
) => ({
  audiobookId,
  trackId: `${audiobookId}-2`,
  seconds: 120,
  updatedAt,
  finished: false,
  ...overrides,
});

describe("Resuming an Audiobook", () => {
  it("starts at the beginning of a book never played", () => {
    expect(resumePoint(book("frankl"), null)).toBeNull();
  });

  it("resumes from the position kept on this phone", () => {
    expect(resumePoint(book("frankl"), kept("frankl", 10))).toEqual({
      trackId: "frankl-2",
      seconds: 120,
    });
  });

  it("resumes from the desktop's position when it is newer, as from another device", () => {
    const frankl = book("frankl", {
      listeningPosition: { trackId: "frankl-1", seconds: 30, updatedAt: 20 },
    });

    expect(resumePoint(frankl, kept("frankl", 10))).toEqual({
      trackId: "frankl-1",
      seconds: 30,
    });
  });

  it("keeps this phone's position over an older one from the desktop", () => {
    const frankl = book("frankl", {
      listeningPosition: { trackId: "frankl-1", seconds: 30, updatedAt: 5 },
    });

    expect(resumePoint(frankl, kept("frankl", 10))).toEqual({
      trackId: "frankl-2",
      seconds: 120,
    });
  });

  it("starts a finished book again from the beginning", () => {
    expect(
      resumePoint(book("frankl"), kept("frankl", 10, { finished: true })),
    ).toBeNull();
    const finishedOnDesktop = book("frankl", {
      listeningPosition: { trackId: "frankl-2", seconds: 300, updatedAt: 20 },
      finished: true,
    });
    expect(resumePoint(finishedOnDesktop, kept("frankl", 10))).toBeNull();
  });
});

describe("Continue listening", () => {
  it("shows books started but not finished on any device, newest first", () => {
    const books = [
      book("never-played"),
      book("orwell", {
        listeningPosition: { trackId: "orwell-1", seconds: 5, updatedAt: 30 },
      }),
      book("frankl"),
      book("finished", {
        listeningPosition: {
          trackId: "finished-2",
          seconds: 300,
          updatedAt: 40,
        },
        finished: true,
      }),
    ];

    const row = continueListening(books, { frankl: kept("frankl", 50) });

    expect(row.map((b) => b.id)).toEqual(["frankl", "orwell"]);
  });

  it("drops a book once it is finished on this phone, even if the desktop hasn't heard", () => {
    const books = [
      book("frankl", {
        listeningPosition: { trackId: "frankl-1", seconds: 5, updatedAt: 30 },
      }),
    ];

    expect(
      continueListening(books, {
        frankl: kept("frankl", 40, { finished: true }),
      }),
    ).toEqual([]);
  });

  it("brings a book back once it is started over", () => {
    const books = [
      book("frankl", {
        listeningPosition: { trackId: "frankl-2", seconds: 300, updatedAt: 30 },
        finished: true,
      }),
    ];

    expect(
      continueListening(books, {
        frankl: kept("frankl", 40, { trackId: "frankl-1", seconds: 0 }),
      }).map((b) => b.id),
    ).toEqual(["frankl"]);
  });
});

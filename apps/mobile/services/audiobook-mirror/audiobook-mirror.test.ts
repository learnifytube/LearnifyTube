import { planAudiobookMirror } from "./planAudiobookMirror";

describe("planAudiobookMirror", () => {
  it("fetches every sent Audiobook the phone doesn't hold", () => {
    const plan = planAudiobookMirror({
      sentIds: ["orwell", "frankl"],
      holds: [],
    });

    expect(plan.hold).toEqual(["orwell", "frankl"]);
    expect(plan.release).toEqual([]);
  });

  it("keeps fetching a sent Audiobook the Mirror brought", () => {
    const plan = planAudiobookMirror({
      sentIds: ["orwell"],
      holds: [{ id: "orwell", reasons: ["mirrored"] }],
    });

    expect(plan.hold).toEqual(["orwell"]);
    expect(plan.release).toEqual([]);
  });

  it("removes an Audiobook the Mirror brought once it is no longer sent", () => {
    const plan = planAudiobookMirror({
      sentIds: [],
      holds: [{ id: "orwell", reasons: ["mirrored"] }],
    });

    expect(plan.hold).toEqual([]);
    expect(plan.release).toEqual(["orwell"]);
  });

  it("never removes an Audiobook the user pulled by playing it", () => {
    const sent = planAudiobookMirror({
      sentIds: ["frankl"],
      holds: [{ id: "frankl", reasons: ["pulled"] }],
    });
    expect(sent.hold).toEqual([]);

    const unsent = planAudiobookMirror({
      sentIds: [],
      holds: [{ id: "frankl", reasons: ["pulled"] }],
    });
    expect(unsent.release).toEqual([]);
  });

  it("leaves a pulled Audiobook the Mirror also brought to the user when it is unsent", () => {
    const plan = planAudiobookMirror({
      sentIds: [],
      holds: [{ id: "frankl", reasons: ["mirrored", "pulled"] }],
    });

    // Releasing only drops the Mirror's reason; the pulled hold keeps the book.
    expect(plan.release).toEqual(["frankl"]);
  });
});
